/**
 * Sync Manager
 * 同步管理器 - 管理剪贴板内容的上传和下载
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SyncClipboardAPI } from './SyncClipboardAPI';
import { WebDAVClient } from './WebDAVClient';
import { AuthService } from './AuthService';
import { clipboardManager } from './ClipboardManager';
import { clipboardMonitor } from './ClipboardMonitor';
import { ConfigurationError } from './errors';
import { ServerConfig } from '../types/api';
import { compareHash } from '../utils/hash';
import {
  SyncConfig,
  SyncStatus,
  SyncMode,
  SyncDirection,
  SyncResult,
  SyncTask,
  SyncEvent,
  SyncEventType,
  SyncListener,
  SyncStats,
  ConflictResolution,
  OfflineQueueItem,
} from '../types/sync';
import { ClipboardContent } from '../types/clipboard';

const STORAGE_KEY_CONFIG = '@syncclipboard:sync:config';
const STORAGE_KEY_STATS = '@syncclipboard:sync:stats';
const STORAGE_KEY_QUEUE = '@syncclipboard:sync:queue';
const STORAGE_KEY_LAST_HASH = '@syncclipboard:sync:last_hash';

/**
 * 默认同步配置
 */
const DEFAULT_CONFIG: Partial<SyncConfig> = {
  mode: SyncMode.Manual,
  interval: 5000, // 5秒
  conflictResolution: ConflictResolution.UseNewest,
  enableOfflineQueue: true,
  maxOfflineQueueSize: 100,
  syncLargeFiles: true,
  largeFileThreshold: 10 * 1024 * 1024, // 10MB
  maxRetries: 3,
  retryDelay: 2000, // 2秒
};

/**
 * 同步管理器
 */
export class SyncManager {
  private static instance: SyncManager | null = null;

  private config: SyncConfig | null = null;
  private apiClient: any | null = null;
  private clipboardManager = clipboardManager;
  private clipboardMonitor = clipboardMonitor;

  private status: SyncStatus = SyncStatus.Idle;
  private listeners: Map<string, SyncListener> = new Map();
  private stats: SyncStats = {
    totalSyncs: 0,
    successCount: 0,
    failureCount: 0,
    uploadCount: 0,
    downloadCount: 0,
    skipCount: 0,
    conflictCount: 0,
  };

  private syncTimer: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private lastLocalHash: string | null = null;
  private lastRemoteHash: string | null = null;
  private offlineQueue: OfflineQueueItem[] = [];

  private constructor() {
    // Singleton instances are initialized as class properties
  }

  /**
   * 获取单例实例
   */
  public static getInstance(): SyncManager {
    if (!SyncManager.instance) {
      SyncManager.instance = new SyncManager();
    }
    return SyncManager.instance;
  }

  /**
   * 创建 API 客户端
   */
  private createAPIClient(config: ServerConfig): SyncClipboardAPI | WebDAVClient {
    const { type, url, username, password } = config;

    if (!url) {
      throw new ConfigurationError('Server URL is required');
    }

    if (type === 'webdav') {
      if (!username || !password) {
        throw new ConfigurationError('Username and password are required for WebDAV');
      }
      return new WebDAVClient({ baseURL: url, username, password });
    }

    if (type === 'standalone') {
      const authService = username && password ? new AuthService(username, password) : undefined;
      return new SyncClipboardAPI({ baseURL: url, authService });
    }

    throw new ConfigurationError(`Unsupported server type: ${type}`);
  }

  /**
   * 初始化同步管理器
   */
  public async initialize(config: SyncConfig): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...config } as SyncConfig;

    // 创建 API 客户端
    this.apiClient = this.createAPIClient(config.server);

    // 加载持久化数据
    await this.loadPersistedData();

    // 如果是自动模式，启动自动同步
    if (this.config.mode === SyncMode.Auto) {
      this.startAutoSync();
    }

    // 如果是实时模式，监听剪贴板变化
    if (this.config.mode === SyncMode.Realtime) {
      this.startRealtimeSync();
    }

    // 处理离线队列
    if (this.config.enableOfflineQueue && this.offlineQueue.length > 0) {
      await this.processOfflineQueue();
    }
  }

  /**
   * 销毁同步管理器
   */
  public async destroy(): Promise<void> {
    this.stopAutoSync();
    this.stopRealtimeSync();
    await this.savePersistedData();
    this.listeners.clear();
  }

  /**
   * 手动同步
   */
  public async sync(direction: SyncDirection = SyncDirection.Both): Promise<SyncResult> {
    if (!this.config || !this.apiClient) {
      throw new Error('SyncManager not initialized');
    }

    if (this.isSyncing) {
      return {
        success: false,
        direction,
        error: 'Sync already in progress',
      };
    }

    const startTime = Date.now();
    this.isSyncing = true;
    this.setStatus(SyncStatus.Syncing);
    this.emitEvent({
      type: SyncEventType.Started,
      timestamp: Date.now(),
    });

    try {
      let result: SyncResult;

      switch (direction) {
        case SyncDirection.Upload:
          result = await this.upload();
          break;
        case SyncDirection.Download:
          result = await this.download();
          break;
        case SyncDirection.Both:
          // 先下载后上传，避免覆盖远程内容
          const downloadResult = await this.download();
          if (downloadResult.success || downloadResult.skipped) {
            const uploadResult = await this.upload();
            result = uploadResult;
          } else {
            result = downloadResult;
          }
          break;
      }

      result.duration = Date.now() - startTime;

      // 更新统计信息
      this.updateStats(result);

      // 发送完成事件
      this.emitEvent({
        type: SyncEventType.Completed,
        result,
        timestamp: Date.now(),
      });

      this.setStatus(result.success ? SyncStatus.Success : SyncStatus.Failed);

      return result;
    } catch (error) {
      const result: SyncResult = {
        success: false,
        direction,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };

      this.updateStats(result);
      this.emitEvent({
        type: SyncEventType.Failed,
        result,
        timestamp: Date.now(),
      });

      this.setStatus(SyncStatus.Failed);

      return result;
    } finally {
      this.isSyncing = false;
      await this.savePersistedData();
    }
  }

  /**
   * 上传剪贴板内容
   */
  private async upload(): Promise<SyncResult> {
    if (!this.apiClient || !this.config) {
      throw new Error('SyncManager not initialized');
    }

    try {
      // 获取本地剪贴板内容
      const localContent = await this.clipboardManager.getClipboardContent();

      if (!localContent) {
        return {
          success: true,
          direction: SyncDirection.Upload,
          skipped: true,
        };
      }

      // 计算当前 hash
      const currentHash = localContent.hash;

      // 如果内容未变化，跳过上传
      if (this.lastLocalHash && currentHash && compareHash(currentHash, this.lastLocalHash)) {
        return {
          success: true,
          direction: SyncDirection.Upload,
          contentHash: currentHash,
          skipped: true,
        };
      }

      // 检查是否是大文件
      if (localContent.fileSize) {
        const isLargeFile = localContent.fileSize > this.config.largeFileThreshold;
        if (isLargeFile && !this.config.syncLargeFiles) {
          return {
            success: false,
            direction: SyncDirection.Upload,
            error: `File too large (${localContent.fileSize} bytes)`,
          };
        }
      }

      // 转换为 ProfileDto
      const { contentToProfileDto } = await import('../utils/clipboard');
      const profile = await contentToProfileDto(localContent);

      // 上传配置
      await this.apiClient.put('/SyncClipboard.json', profile);

      // 如果有文件数据，上传文件
      if (localContent.fileData && profile.dataName) {
        const blob = new Blob([localContent.fileData]);
        await this.apiClient.put(`/SyncClipboard/${encodeURIComponent(profile.dataName)}`, blob, {
          headers: {
            'Content-Type': 'application/octet-stream',
          },
        });
      }

      // 更新最后上传的 hash
      this.lastLocalHash = currentHash || null;
      if (currentHash) {
        await AsyncStorage.setItem(STORAGE_KEY_LAST_HASH, currentHash);
      }

      return {
        success: true,
        direction: SyncDirection.Upload,
        contentHash: currentHash,
      };
    } catch (error) {
      // 如果启用离线队列且是网络错误，添加到队列
      if (this.config.enableOfflineQueue && this.isNetworkError(error)) {
        const content = await this.clipboardManager.getClipboardContent();
        if (content) {
          const task: SyncTask = {
            id: `upload-${Date.now()}`,
            direction: SyncDirection.Upload,
            content,
            createdAt: Date.now(),
            retries: 0,
          };
          await this.addToOfflineQueue(task);
        }
        return {
          success: false,
          direction: SyncDirection.Upload,
          error: error instanceof Error ? error.message : 'Network error, added to queue',
        };
      } else {
        return {
          success: false,
          direction: SyncDirection.Upload,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  }

  /**
   * 下载剪贴板内容
   */
  private async download(): Promise<SyncResult> {
    if (!this.apiClient || !this.config) {
      throw new Error('SyncManager not initialized');
    }

    try {
      // 获取远程剪贴板配置
      const profile = await this.apiClient.get('/SyncClipboard.json');

      if (!profile || !profile.hash) {
        return {
          success: true,
          direction: SyncDirection.Download,
          skipped: true,
        };
      }

      const remoteHash = profile.hash;

      // 如果远程内容未变化，跳过下载
      if (this.lastRemoteHash && compareHash(remoteHash, this.lastRemoteHash)) {
        return {
          success: true,
          direction: SyncDirection.Download,
          contentHash: remoteHash,
          skipped: true,
        };
      }

      // 获取本地剪贴板内容（用于冲突检测）
      const localContent = await this.clipboardManager.getClipboardContent();

      // 检测冲突
      if (localContent && localContent.hash) {
        if (
          !compareHash(localContent.hash, remoteHash) &&
          this.lastLocalHash &&
          !compareHash(localContent.hash, this.lastLocalHash)
        ) {
          // 本地和远程都有修改，存在冲突
          const resolution = await this.resolveConflict(localContent, profile);

          if (resolution === 'local') {
            // 使用本地版本，上传覆盖远程
            return await this.upload();
          } else if (resolution === 'skip') {
            // 跳过此次同步
            return {
              success: true,
              direction: SyncDirection.Download,
              contentHash: remoteHash,
              hasConflict: true,
              skipped: true,
            };
          }
          // 否则继续下载（使用远程版本）
        }
      }

      // 转换为 ClipboardContent
      const { profileDtoToContent } = await import('../utils/clipboard');
      const content = profileDtoToContent(profile);

      // 如果有文件数据，下载文件
      if (profile.hasData && profile.dataName) {
        try {
          const fileData = await this.apiClient.get(
            `/SyncClipboard/${encodeURIComponent(profile.dataName)}`,
            {
              responseType: 'arraybuffer',
            }
          );
          content.fileData = fileData;
        } catch (error) {
          console.warn('Failed to download file data:', error);
          // 继续处理，即使文件下载失败
        }
      }

      // 设置到本地剪贴板
      await this.clipboardManager.setClipboardContent(content);

      // 更新最后下载的 hash
      this.lastRemoteHash = remoteHash;

      return {
        success: true,
        direction: SyncDirection.Download,
        contentHash: remoteHash,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 启动自动同步
   */
  private startAutoSync(): void {
    if (!this.config) return;

    this.stopAutoSync();

    const interval = this.config.interval || 5000;
    this.syncTimer = setInterval(() => {
      this.sync(SyncDirection.Both).catch((error) => {
        console.error('Auto sync failed:', error);
      });
    }, interval);
  }

  /**
   * 停止自动同步
   */
  private stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * 启动实时同步
   */
  private startRealtimeSync(): void {
    this.clipboardMonitor.addCallback(async () => {
      // 当剪贴板变化时，上传新内容
      await this.sync(SyncDirection.Upload);
    });
    this.clipboardMonitor.start();
  }

  /**
   * 停止实时同步
   */
  private stopRealtimeSync(): void {
    this.clipboardMonitor.stop();
  }

  /**
   * 处理离线队列
   */
  private async processOfflineQueue(): Promise<void> {
    if (!this.config?.enableOfflineQueue || this.offlineQueue.length === 0) {
      return;
    }

    const maxRetries = this.config.maxRetries || 3;
    const failedTasks: OfflineQueueItem[] = [];

    for (const item of this.offlineQueue) {
      try {
        // 尝试执行任务
        if (item.task.direction === SyncDirection.Upload) {
          await this.upload();
        } else if (item.task.direction === SyncDirection.Download) {
          await this.download();
        }

        // 任务成功，不添加回队列
      } catch (error) {
        // 任务失败，增加重试次数
        item.task.retries++;
        item.task.lastError = error instanceof Error ? error.message : 'Unknown error';

        // 如果未达到最大重试次数，保留在队列中
        if (item.task.retries < maxRetries) {
          failedTasks.push(item);
        } else {
          console.error(`Task ${item.taskId} exceeded max retries:`, error);
        }
      }
    }

    // 更新队列（只保留失败但未超过重试次数的任务）
    this.offlineQueue = failedTasks;
    await this.saveOfflineQueue();
  }

  /**
   * 解决冲突
   */
  private async resolveConflict(
    localContent: ClipboardContent,
    remoteProfile: any
  ): Promise<'local' | 'remote' | 'skip'> {
    if (!this.config) {
      return 'remote';
    }

    switch (this.config.conflictResolution) {
      case ConflictResolution.UseLocal:
        return 'local';

      case ConflictResolution.UseRemote:
        return 'remote';

      case ConflictResolution.UseNewest:
        // 比较时间戳（假设 remoteProfile 有时间戳）
        // 如果没有时间戳，默认使用远程版本
        return 'remote';

      case ConflictResolution.Ask:
        // 发送冲突事件，等待用户决策
        this.emitEvent({
          type: SyncEventType.Conflict,
          data: { localContent, remoteProfile },
          timestamp: Date.now(),
        });
        // 暂时跳过，等待用户手动解决
        return 'skip';

      default:
        return 'remote';
    }
  }

  /**
   * 判断是否是网络错误
   */
  private isNetworkError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('connection') ||
        message.includes('econnrefused') ||
        message.includes('offline')
      );
    }
    return false;
  }

  /**
   * 添加任务到离线队列
   */
  private async addToOfflineQueue(task: SyncTask): Promise<void> {
    if (!this.config?.enableOfflineQueue) return;

    const item: OfflineQueueItem = {
      taskId: task.id,
      task,
      queuedAt: Date.now(),
    };

    this.offlineQueue.push(item);

    // 限制队列大小
    const maxSize = this.config.maxOfflineQueueSize || 100;
    if (this.offlineQueue.length > maxSize) {
      this.offlineQueue.shift(); // 移除最旧的任务
    }

    await this.saveOfflineQueue();
  }

  /**
   * 设置同步状态
   */
  private setStatus(status: SyncStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emitEvent({
        type: SyncEventType.StatusChanged,
        status,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 添加事件监听器
   */
  public addListener(id: string, listener: SyncListener): void {
    this.listeners.set(id, listener);
  }

  /**
   * 移除事件监听器
   */
  public removeListener(id: string): void {
    this.listeners.delete(id);
  }

  /**
   * 发送事件
   */
  private emitEvent(event: SyncEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in sync listener:', error);
      }
    });
  }

  /**
   * 更新统计信息
   */
  private updateStats(result: SyncResult): void {
    this.stats.totalSyncs++;
    this.stats.lastSyncTime = Date.now();

    if (result.success) {
      this.stats.successCount++;
      this.stats.lastSuccessTime = Date.now();

      if (result.direction === SyncDirection.Upload) {
        this.stats.uploadCount++;
      } else if (result.direction === SyncDirection.Download) {
        this.stats.downloadCount++;
      }
    } else {
      this.stats.failureCount++;
    }

    if (result.skipped) {
      this.stats.skipCount++;
    }

    if (result.hasConflict) {
      this.stats.conflictCount++;
    }

    // 更新平均耗时
    if (result.duration) {
      const currentAvg = this.stats.averageDuration || 0;
      const totalCount = this.stats.successCount;
      this.stats.averageDuration = (currentAvg * (totalCount - 1) + result.duration) / totalCount;
    }
  }

  /**
   * 加载持久化数据
   */
  private async loadPersistedData(): Promise<void> {
    try {
      // 加载统计信息
      const statsJson = await AsyncStorage.getItem(STORAGE_KEY_STATS);
      if (statsJson) {
        this.stats = JSON.parse(statsJson);
      }

      // 加载离线队列
      const queueJson = await AsyncStorage.getItem(STORAGE_KEY_QUEUE);
      if (queueJson) {
        this.offlineQueue = JSON.parse(queueJson);
      }

      // 加载最后的 hash 值
      this.lastLocalHash = await AsyncStorage.getItem(STORAGE_KEY_LAST_HASH);
    } catch (error) {
      console.error('Failed to load persisted data:', error);
    }
  }

  /**
   * 保存持久化数据
   */
  private async savePersistedData(): Promise<void> {
    try {
      await AsyncStorage.multiSet([
        [STORAGE_KEY_STATS, JSON.stringify(this.stats)],
        [STORAGE_KEY_QUEUE, JSON.stringify(this.offlineQueue)],
        [STORAGE_KEY_LAST_HASH, this.lastLocalHash || ''],
      ]);
    } catch (error) {
      console.error('Failed to save persisted data:', error);
    }
  }

  /**
   * 保存离线队列
   */
  private async saveOfflineQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(this.offlineQueue));
    } catch (error) {
      console.error('Failed to save offline queue:', error);
    }
  }

  /**
   * 获取当前状态
   */
  public getStatus(): SyncStatus {
    return this.status;
  }

  /**
   * 获取统计信息
   */
  public getStats(): SyncStats {
    return { ...this.stats };
  }

  /**
   * 获取离线队列大小
   */
  public getOfflineQueueSize(): number {
    return this.offlineQueue.length;
  }

  /**
   * 清空离线队列
   */
  public async clearOfflineQueue(): Promise<void> {
    this.offlineQueue = [];
    await this.saveOfflineQueue();
  }

  /**
   * 更新配置
   */
  public async updateConfig(config: Partial<SyncConfig>): Promise<void> {
    if (!this.config) {
      throw new Error('SyncManager not initialized');
    }

    const oldMode = this.config.mode;
    this.config = { ...this.config, ...config };

    // 如果模式改变，重新启动同步
    if (oldMode !== this.config.mode) {
      this.stopAutoSync();
      this.stopRealtimeSync();

      if (this.config.mode === SyncMode.Auto) {
        this.startAutoSync();
      } else if (this.config.mode === SyncMode.Realtime) {
        this.startRealtimeSync();
      }
    }

    await AsyncStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
  }

  /**
   * 获取配置
   */
  public getConfig(): SyncConfig | null {
    return this.config ? { ...this.config } : null;
  }
}
