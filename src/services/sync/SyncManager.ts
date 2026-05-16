/**
 * Sync Manager
 * 同步管理器 - 管理剪贴板内容的上传和下载
 */

import { Platform } from 'react-native';
import { getAPIClient } from '../ClientFactory';
import { localClipboard } from '../clipboard/LocalClipboard';
import { ProfileDto } from '../../types/api';
import { compareHash } from '../../utils/hash';
import { isTextInvalid } from '../../utils/index';
import type { ProgressInfo } from 'native-util';
import {
  SyncStatus,
  SyncDirection,
  SyncResult,
  SyncEvent,
  SyncEventType,
  SyncListener,
  ConflictResolution,
} from '../../types/sync';
import { ClipboardContent } from '../../types/clipboard';
import { configStorage } from '../../storage';
import { getLastSyncHash, setLastSyncHash } from '../../storage/SyncStateStorage';

/**
 * 同步管理器
 */
export class SyncManager {
  private static instance: SyncManager | null = null;

  private clipboardManager = localClipboard;

  private status: SyncStatus = SyncStatus.Idle;
  private listeners: Map<string, SyncListener> = new Map();
  private persistedDataLoaded = false;

  private isSyncing = false;
  private currentSyncPromise: Promise<SyncResult> | null = null;
  private currentSyncAbortController: AbortController | null = null;
  private lastLocalProfileHash: string | null = null;
  private lastRemoteProfileHash: string | null = null;
  private pendingUploadContent: ClipboardContent | null = null;

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

  public setPendingUploadContent(content: ClipboardContent | null): void {
    this.pendingUploadContent = content;
  }

  /**
   * 获取最后上传的 profile hash（用于外部去重判断）
   */
  public getLastUploadedHash(): string | null {
    return this.lastLocalProfileHash;
  }

  /**
   * 设置最后上传的 profile hash（供绕过 SyncManager.sync() 的直接上传路径设置，避免触发自动下载）
   */
  public setLastUploadedHash(hash: string): void {
    this.lastLocalProfileHash = hash;
  }

  /**
   * 更新前台服务通知文本（自动附加时间戳）
   */
  public updateForegroundNotification(text: string): void {
    if (Platform.OS !== 'android') return;
    // 将 "已上传: preview" 格式转为 "↑ 已上传\npreview"
    const colonIdx = text.indexOf(': ');
    let content: string;
    if (colonIdx >= 0) {
      const action = text.slice(0, colonIdx);
      const preview = text.slice(colonIdx + 2);
      content = `${action}\n${preview}`;
    } else {
      content = `SyncClipboard\n${text}`;
    }
    import('foreground-service')
      .then((ForegroundService) => {
        ForegroundService.updateNotification(content);
      })
      .catch(() => {
        // foreground service module not available
      });
  }

  /**
   * 确保持久化数据已加载（首次调用时懒加载）
   */
  private async ensurePersistedDataLoaded(): Promise<void> {
    if (this.persistedDataLoaded) return;
    await this.loadPersistedData();
    this.persistedDataLoaded = true;
  }

  /**
   * 销毁同步管理器
   */
  public async destroy(): Promise<void> {
    this.listeners.clear();
  }

  /**
   * 手动同步
   */
  public async sync(
    direction: SyncDirection,
    isAuto: boolean = false,
    signal?: AbortSignal,
    onProgress?: (info: ProgressInfo) => void,
    onPreview?: (preview: string) => void
  ): Promise<SyncResult> {
    await this.ensurePersistedDataLoaded();

    if (this.isSyncing) {
      if (isAuto) {
        // 自动同步：跳过本次执行
        return {
          success: false,
          skipped: true,
          direction,
          error: 'Sync already in progress',
        };
      }
      // 手动/快速操作：取消当前同步后再执行
      if (this.currentSyncAbortController) {
        this.currentSyncAbortController.abort();
      }
      if (this.currentSyncPromise) {
        await this.currentSyncPromise.catch(() => {});
      }
    }

    // 创建内部 AbortController，与外部 signal 合并
    const internalAbortController = new AbortController();
    this.currentSyncAbortController = internalAbortController;
    let mergedSignal: AbortSignal;
    if (signal) {
      // 外部 signal 取消时也取消内部 controller
      const onExternalAbort = () => internalAbortController.abort();
      signal.addEventListener('abort', onExternalAbort, { once: true });
      mergedSignal = internalAbortController.signal;
    } else {
      mergedSignal = internalAbortController.signal;
    }

    const startTime = Date.now();
    this.isSyncing = true;
    this.setStatus(SyncStatus.Syncing);
    this.emitEvent({
      type: SyncEventType.Started,
      timestamp: Date.now(),
    });

    const doSync = async (): Promise<SyncResult> => {
      try {
        let result: SyncResult;

        switch (direction) {
          case SyncDirection.Upload:
            result = await this.upload(isAuto, mergedSignal, onProgress, onPreview);
            break;
          case SyncDirection.Download:
            result = await this.download(isAuto, mergedSignal, onProgress, onPreview);
            break;
        }

        result.duration = Date.now() - startTime;

        // 发送完成事件
        this.emitEvent({
          type: SyncEventType.Completed,
          result,
          timestamp: Date.now(),
        });

        this.setStatus(result.success ? SyncStatus.Success : SyncStatus.Failed);

        return result;
      } catch (error) {
        // 用户取消操作不视为失败
        if (error instanceof Error && error.name === 'AbortError') {
          const result: SyncResult = {
            success: false,
            direction,
            error: error.message,
            duration: Date.now() - startTime,
            skipped: true,
          };

          this.setStatus(SyncStatus.Idle);

          return result;
        }

        // 提取详细错误信息，包含HTTP状态码
        let errorMessage = 'Unknown error';
        if (error instanceof Error) {
          errorMessage = error.message;
          // 如果错误对象包含statusCode属性，添加到错误消息中
          if ('statusCode' in error && typeof error.statusCode === 'number') {
            errorMessage = `HTTP ${error.statusCode}: ${errorMessage}`;
          }
        }

        const result: SyncResult = {
          success: false,
          direction,
          error: errorMessage,
          duration: Date.now() - startTime,
        };

        this.emitEvent({
          type: SyncEventType.Failed,
          result,
          timestamp: Date.now(),
        });

        this.setStatus(SyncStatus.Failed);

        return result;
      } finally {
        this.isSyncing = false;
        this.currentSyncPromise = null;
        this.currentSyncAbortController = null;
        await this.savePersistedData();
      }
    };

    this.currentSyncPromise = doSync();
    return this.currentSyncPromise;
  }

  /**
   * 上传剪贴板内容
   */
  private async upload(
    isAuto: boolean = false,
    signal?: AbortSignal,
    onProgress?: (info: ProgressInfo) => void,
    onPreview?: (preview: string) => void
  ): Promise<SyncResult> {
    const apiClient = await getAPIClient();
    const appConfig = await configStorage.getConfig();
    try {
      // 优先使用已缓存的内容（来自 ClipboardMonitor 回调，避免后台时重新创建悬浮窗）
      let localContent =
        this.pendingUploadContent || (await this.clipboardManager.getClipboardContent());

      if (!localContent) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        localContent = await this.clipboardManager.getClipboardContent();
      }

      if (!localContent) {
        return {
          success: true,
          direction: SyncDirection.Upload,
          skipped: true,
        };
      }

      // 调用预览回调
      if (onPreview) {
        if (localContent.type === 'Text' && !isTextInvalid(localContent.text)) {
          const preview = localContent.text.trim().replace(/\s+/g, ' ');
          onPreview(preview.length > 40 ? preview.slice(0, 40) + '…' : preview);
        } else if (localContent.type !== 'Text' && localContent.fileName) {
          onPreview(localContent.fileName);
        }
      }

      // 计算当前 profileHash
      const currentProfileHash = localContent.profileHash;

      // 如果内容未变化，跳过上传（仅在自动同步时）
      if (
        isAuto &&
        this.lastLocalProfileHash &&
        currentProfileHash &&
        compareHash(currentProfileHash, this.lastLocalProfileHash)
      ) {
        return {
          success: true,
          direction: SyncDirection.Upload,
          profileHash: currentProfileHash,
          skipped: true,
        };
      }

      // 检查是否是大文件（仅在自动同步时）
      if (isAuto && localContent.fileSize) {
        const isLargeFile = localContent.fileSize > appConfig.largeFileThreshold;
        if (isLargeFile && !appConfig.syncLargeFiles) {
          return {
            success: false,
            direction: SyncDirection.Upload,
            error: `File too large (${localContent.fileSize} bytes)`,
          };
        }
      }

      // 转换为 ProfileDto
      const { contentToProfileDto } = await import('../../utils/clipboard/convert');
      const profile = await contentToProfileDto(localContent);

      console.log('[SyncManager] Upload - Profile info:', {
        type: profile.type,
        hasData: profile.hasData,
        dataName: profile.dataName,
        size: profile.size,
      });

      console.log('[SyncManager] Upload - Content info:', {
        type: localContent.type,
        hasFileData: !!localContent.fileData,

        fileUri: localContent.fileUri,
        fileSize: localContent.fileSize,
      });

      // 预设最后上传的 profileHash（防止 SignalR 在 HTTP 响应返回前推送通知导致误触自动下载）
      const previousProfileHash = this.lastLocalProfileHash;
      if (currentProfileHash) {
        this.lastLocalProfileHash = currentProfileHash;
      }

      // 使用 putContent 统一处理：先上传数据（如果有），再上传配置
      try {
        await apiClient.putContent(localContent, { signal, onProgress });
      } catch (uploadError) {
        // 上传失败，回滚 hash
        this.lastLocalProfileHash = previousProfileHash;
        throw uploadError;
      }

      console.log('[SyncManager] Content uploaded successfully');

      // 持久化 profileHash
      if (currentProfileHash) {
        await setLastSyncHash(currentProfileHash);
      }

      return {
        success: true,
        direction: SyncDirection.Upload,
        profileHash: currentProfileHash,
        content: localContent,
      };
    } catch (error) {
      console.error('[SyncManager] Upload failed with error:', error);
      console.error('[SyncManager] Error type:', typeof error);
      console.error('[SyncManager] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
      });

      // 使用已经处理好的错误信息
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        success: false,
        direction: SyncDirection.Upload,
        error: errorMessage,
      };
    }
  }

  /**
   * 下载剪贴板内容
   */
  private async download(
    isAuto: boolean = false,
    signal?: AbortSignal,
    onProgress?: (info: ProgressInfo) => void,
    onPreview?: (preview: string) => void
  ): Promise<SyncResult> {
    const apiClient = await getAPIClient();
    const appConfig = await configStorage.getConfig();
    try {
      // 获取远程剪贴板配置
      const profile = await apiClient.getClipboard(signal);

      if (!profile || !profile.hash) {
        return {
          success: true,
          direction: SyncDirection.Download,
          skipped: true,
        };
      }

      const remoteProfileHash = profile.hash;

      // 调用预览回调
      if (onPreview) {
        if (profile.type === 'Text' && profile.hasData && !isTextInvalid(profile.text)) {
          const preview = profile.text.trim().replace(/\s+/g, ' ');
          onPreview(preview.length > 40 ? preview.slice(0, 40) + '…' : preview);
        } else if (profile.hasData && profile.dataName) {
          onPreview(profile.dataName);
        }
      }

      // 如果远程内容未变化，跳过下载（仅在自动同步时）
      if (
        isAuto &&
        this.lastRemoteProfileHash &&
        compareHash(remoteProfileHash, this.lastRemoteProfileHash)
      ) {
        return {
          success: true,
          direction: SyncDirection.Download,
          profileHash: remoteProfileHash,
          skipped: true,
        };
      }

      // 获取本地剪贴板内容（用于冲突检测）
      const localContent = await this.clipboardManager.getClipboardContent();

      // 检测冲突
      if (localContent && localContent.profileHash) {
        if (
          !compareHash(localContent.profileHash, remoteProfileHash) &&
          this.lastLocalProfileHash &&
          !compareHash(localContent.profileHash, this.lastLocalProfileHash)
        ) {
          // 本地和远程都有修改，存在冲突
          const resolution = await this.resolveConflict(
            localContent,
            profile,
            appConfig.conflictResolution
          );

          if (resolution === 'local') {
            // 使用本地版本，上传覆盖远程
            return await this.upload(isAuto, signal, onProgress, onPreview);
          } else if (resolution === 'skip') {
            // 跳过此次同步
            return {
              success: true,
              direction: SyncDirection.Download,
              profileHash: remoteProfileHash,
              hasConflict: true,
              skipped: true,
            };
          }
          // 否则继续下载（使用远程版本）
        }
      }

      // 转换为 ClipboardContent
      const { profileDtoToContent } = await import('../../utils/clipboard/convert');
      const content = profileDtoToContent(profile);

      // 如果有文件数据，优先从历史记录读取缓存，否则下载并保存到历史记录
      if (profile.hasData && profile.dataName) {
        // 检查文件大小是否超过"允许自动同步的数据大小"限制
        const autoDownloadMaxSize = appConfig.autoDownloadMaxSize;
        if (profile.size && profile.size > autoDownloadMaxSize) {
          console.log(
            `[SyncManager] File too large (${profile.size} bytes > ${autoDownloadMaxSize} bytes), skipping auto-download`
          );
          return {
            success: true,
            direction: SyncDirection.Download,
            profileHash: remoteProfileHash,
            skipped: true,
          };
        }
        const { downloadAndAddToHistory } = await import('../../utils/remoteClipboard');
        const updatedContent = await downloadAndAddToHistory(
          content,
          apiClient,
          true,
          signal,
          onProgress
        );
        content.fileUri = updatedContent.fileUri;
      }

      // 设置到本地剪贴板（仅 Text 类型，图片和文件不写入系统剪贴板）
      if (content.type === 'Text') {
        await this.clipboardManager.setClipboardContent(content);
      }

      // 更新最后下载的 profileHash
      this.lastRemoteProfileHash = remoteProfileHash;

      return {
        success: true,
        direction: SyncDirection.Download,
        profileHash: remoteProfileHash,
        content,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 获取内容预览文本（用于 Toast 通知）
   */
  public getContentPreview(content: ClipboardContent): string {
    if (content.type === 'Text' && content.text) {
      const text = content.text.trim().replace(/\s+/g, ' ');
      return text.length > 30 ? text.slice(0, 30) + '…' : text;
    }
    if (content.fileName) {
      return content.fileName;
    }
    return content.type;
  }

  /**
   * 解决冲突
   */
  private async resolveConflict(
    localContent: ClipboardContent,
    remoteProfile: ProfileDto,
    conflictResolution: ConflictResolution
  ): Promise<'local' | 'remote' | 'skip'> {
    switch (conflictResolution) {
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
   * 加载持久化数据
   */
  private async loadPersistedData(): Promise<void> {
    try {
      // 加载最后的 profileHash 值
      this.lastLocalProfileHash = await getLastSyncHash();
    } catch (error) {
      console.error('Failed to load persisted data:', error);
    }
  }

  /**
   * 保存持久化数据
   */
  private async savePersistedData(): Promise<void> {
    try {
      await setLastSyncHash(this.lastLocalProfileHash || '');
    } catch (error) {
      console.error('Failed to save persisted data:', error);
    }
  }

  /**
   * 获取当前状态
   */
  public getStatus(): SyncStatus {
    return this.status;
  }
}
