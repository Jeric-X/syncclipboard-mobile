/**
 * History Transfer Queue
 * 历史记录传输队列 - 管理数据上传/下载任务
 */

import type { IHistoryAPI } from '@/api/history';
import { HistoryAPINotInitializedError, RecordNotFoundError } from '@/errors';
import { HistoryStorage } from '../../storage/HistoryStorage';
import { HistorySyncStatus, type ClipboardContent, isLocalFileReady } from '@/types/clipboard';
import { getHistoryFileDir } from '@/utils/fileStorage';
import { historyItemToContent } from '@/utils/clipboard/convert';
import { File } from 'expo-file-system';
import type { ProgressDetail } from '@/types/progress';
import { parseProfileId } from '@/utils/clipboard/profileId';

export type TransferType = 'upload' | 'download';
export type TransferTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waitForRetry';

export type ProgressCallback = (info: ProgressDetail) => void;

export interface TransferTask {
  profileId: string;
  displayName: string;
  type: TransferType;
  status: TransferTaskStatus;
  progress: number;
  bytesTransferred: number;
  totalBytes?: number;
  createdTime: number;
  startedTime?: number;
  completedTime?: number;
  errorMessage?: string;
  failureCount: number;
  abortController: AbortController;
  userCancelled?: boolean;
  isImmediateTask?: boolean;
  externalProgressReporter?: ProgressCallback;
  awaiter: Promise<ClipboardContent>;
}

export interface TransferQueueConfig {
  maxConcurrency: number;
  maxConsecutiveFailures: number;
  retryDelayMs: number;
}

export interface TaskStatusChangedCallback {
  (task: TransferTask): void;
}

const DEFAULT_CONFIG: TransferQueueConfig = {
  maxConcurrency: 3,
  maxConsecutiveFailures: 5,
  retryDelayMs: 3000,
};

export class HistoryTransferQueue {
  private historyStorage: HistoryStorage;
  private historyAPI: IHistoryAPI | null = null;

  private pendingTasks: TransferTask[] = [];
  private activeTasks: Map<string, TransferTask> = new Map();
  private taskStatusCallbacks: Set<TaskStatusChangedCallback> = new Set();
  private taskCompletionResolvers: Map<
    string,
    { resolve: (content: ClipboardContent) => void; reject: (error: Error) => void }
  > = new Map();

  private config: TransferQueueConfig;
  private isRunning = false;
  private consecutiveFailures = 0;
  private processQueuePromise: Promise<void> | null = null;
  private queueSignal: { resolve: () => void } | null = null;

  constructor(config?: Partial<TransferQueueConfig>) {
    this.historyStorage = HistoryStorage.getInstance();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 设置 History API
   */
  setHistoryAPI(api: IHistoryAPI): void {
    this.historyAPI = api;
  }

  /**
   * 启动队列
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.consecutiveFailures = 0;
    this.processQueuePromise = this.processQueueLoop();
  }

  /**
   * 停止队列
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    // 取消所有任务
    for (const task of this.activeTasks.values()) {
      task.abortController.abort();
      task.status = 'cancelled';
      this.notifyStatusChanged(task);
    }

    // 取消待处理任务
    for (const task of this.pendingTasks) {
      task.abortController.abort();
      task.status = 'cancelled';
      this.notifyStatusChanged(task);
    }

    this.activeTasks.clear();
    this.pendingTasks = [];

    // 唤醒队列处理循环
    this.signalQueue();

    if (this.processQueuePromise) {
      await this.processQueuePromise;
      this.processQueuePromise = null;
    }
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
    console.log('[HistoryTransferQueue] Clearing queue');

    // 取消所有活动任务
    for (const task of this.activeTasks.values()) {
      try {
        task.abortController.abort();
        task.status = 'cancelled';
        this.notifyStatusChanged(task);
      } catch (error) {
        console.error('[HistoryTransferQueue] Error cancelling task:', error);
      }
    }

    // 清空待处理队列
    for (const task of this.pendingTasks) {
      task.abortController.abort();
      task.status = 'cancelled';
      this.notifyStatusChanged(task);
    }

    this.pendingTasks = [];
    this.activeTasks.clear();
  }

  /**
   * 添加下载任务
   */
  async addDownloadTask(profileId: string): Promise<TransferTask> {
    const existingTask = this.findTask(profileId, 'download');
    if (existingTask) {
      return existingTask;
    }

    const parsed = parseProfileId(profileId);
    const item = parsed ? await this.historyStorage.getItem(parsed.hash) : null;
    const displayName = item?.text || profileId;

    const key = this.getTaskKey(profileId, 'download');
    let resolveAwaiter: (content: ClipboardContent) => void;
    let rejectAwaiter: (error: Error) => void;
    const awaiter = new Promise<ClipboardContent>((resolve, reject) => {
      resolveAwaiter = resolve;
      rejectAwaiter = reject;
    });

    const task: TransferTask = {
      profileId,
      displayName,
      type: 'download',
      status: 'pending',
      progress: -1,
      bytesTransferred: 0,
      createdTime: Date.now(),
      failureCount: 0,
      abortController: new AbortController(),
      awaiter,
    };

    this.taskCompletionResolvers.set(key, { resolve: resolveAwaiter!, reject: rejectAwaiter! });
    this.pendingTasks.push(task);
    this.notifyStatusChanged(task);
    this.signalQueue();

    console.log(`[HistoryTransferQueue] Added download task: ${profileId}`);
    return task;
  }

  /**
   * 添加上传任务
   */
  async addUploadTask(profileId: string): Promise<TransferTask> {
    const existingTask = this.findTask(profileId, 'upload');
    if (existingTask) {
      return existingTask;
    }

    const { parseProfileId } = await import('@/utils');
    const parsed = parseProfileId(profileId);
    const item = parsed ? await this.historyStorage.getItem(parsed.hash) : null;
    const displayName = item?.text || profileId;

    const key = this.getTaskKey(profileId, 'upload');
    let resolveAwaiter: (content: ClipboardContent) => void;
    let rejectAwaiter: (error: Error) => void;
    const awaiter = new Promise<ClipboardContent>((resolve, reject) => {
      resolveAwaiter = resolve;
      rejectAwaiter = reject;
    });

    const task: TransferTask = {
      profileId,
      displayName,
      type: 'upload',
      status: 'pending',
      progress: -1,
      bytesTransferred: 0,
      createdTime: Date.now(),
      failureCount: 0,
      abortController: new AbortController(),
      awaiter,
    };

    this.taskCompletionResolvers.set(key, { resolve: resolveAwaiter!, reject: rejectAwaiter! });
    this.pendingTasks.push(task);
    this.notifyStatusChanged(task);
    this.signalQueue();

    console.log(`[HistoryTransferQueue] Added upload task: ${profileId}`);
    return task;
  }

  /**
   * 立即执行下载任务
   */
  async executeImmediateDownload(
    content: ClipboardContent,
    progress?: ProgressCallback,
    signal?: AbortSignal
  ): Promise<ClipboardContent> {
    const { getProfileId } = await import('@/utils');
    const profileId = getProfileId(content.type, content.profileHash!);

    const existingTask = this.findTask(profileId, 'download');

    if (existingTask) {
      existingTask.isImmediateTask = true;
      if (progress) {
        existingTask.externalProgressReporter = progress;
      }
      return existingTask.awaiter;
    }

    const { parseProfileId } = await import('@/utils');
    const parsed = parseProfileId(profileId);
    const item = parsed ? await this.historyStorage.getItem(parsed.hash) : null;
    const displayName = item?.text || profileId;

    const key = this.getTaskKey(profileId, 'download');
    let resolveAwaiter: (content: ClipboardContent) => void;
    let rejectAwaiter: (error: Error) => void;
    const awaiter = new Promise<ClipboardContent>((resolve, reject) => {
      resolveAwaiter = resolve;
      rejectAwaiter = reject;
    });

    const abortController = new AbortController();
    if (signal) {
      if (signal.aborted) {
        abortController.abort();
      } else {
        signal.addEventListener('abort', () => abortController.abort());
      }
    }

    const task: TransferTask = {
      profileId,
      displayName,
      type: 'download',
      status: 'pending',
      progress: -1,
      bytesTransferred: 0,
      createdTime: Date.now(),
      failureCount: 0,
      abortController,
      isImmediateTask: true,
      externalProgressReporter: progress,
      awaiter,
    };

    this.taskCompletionResolvers.set(key, { resolve: resolveAwaiter!, reject: rejectAwaiter! });
    this.activeTasks.set(key, task);
    this.notifyStatusChanged(task);

    console.log(`[HistoryTransferQueue] Executing immediate download task: ${profileId}`);

    const result = await this.executeTask(task);

    if (task.status !== 'completed') {
      throw new Error(task.errorMessage || 'Download failed');
    }

    return result;
  }

  /**
   * 立即执行上传任务
   */
  async executeImmediateUpload(
    content: ClipboardContent,
    progress?: ProgressCallback,
    signal?: AbortSignal
  ): Promise<ClipboardContent> {
    const { getProfileId } = await import('@/utils');
    const profileId = getProfileId(content.type, content.profileHash!);

    const existingTask = this.findTask(profileId, 'upload');

    if (existingTask) {
      existingTask.isImmediateTask = true;
      if (progress) {
        existingTask.externalProgressReporter = progress;
      }
      return existingTask.awaiter;
    }

    const { parseProfileId } = await import('@/utils');
    const parsed = parseProfileId(profileId);
    const item = parsed ? await this.historyStorage.getItem(parsed.hash) : null;
    const displayName = item?.text || profileId;

    const key = this.getTaskKey(profileId, 'upload');
    let resolveAwaiter: (content: ClipboardContent) => void;
    let rejectAwaiter: (error: Error) => void;
    const awaiter = new Promise<ClipboardContent>((resolve, reject) => {
      resolveAwaiter = resolve;
      rejectAwaiter = reject;
    });

    const abortController = new AbortController();
    if (signal) {
      if (signal.aborted) {
        abortController.abort();
      } else {
        signal.addEventListener('abort', () => abortController.abort());
      }
    }

    const task: TransferTask = {
      profileId,
      displayName,
      type: 'upload',
      status: 'pending',
      progress: -1,
      bytesTransferred: 0,
      createdTime: Date.now(),
      failureCount: 0,
      abortController,
      isImmediateTask: true,
      externalProgressReporter: progress,
      awaiter,
    };

    this.taskCompletionResolvers.set(key, { resolve: resolveAwaiter!, reject: rejectAwaiter! });
    this.activeTasks.set(key, task);
    this.notifyStatusChanged(task);

    console.log(`[HistoryTransferQueue] Executing immediate upload task: ${profileId}`);

    const result = await this.executeTask(task);

    if (task.status !== 'completed') {
      throw new Error(task.errorMessage || 'Upload failed');
    }

    return result;
  }

  /**
   * 取消任务
   */
  cancelTask(profileId: string, type: TransferType): boolean {
    const task = this.findTask(profileId, type);
    if (!task) return false;

    task.abortController.abort();
    task.status = 'cancelled';
    task.userCancelled = true;
    this.notifyStatusChanged(task);

    // 从待处理队列移除
    const pendingIndex = this.pendingTasks.findIndex(
      (t) => t.profileId === profileId && t.type === type
    );
    if (pendingIndex >= 0) {
      this.pendingTasks.splice(pendingIndex, 1);
    }

    // 从活动任务移除
    const key = this.getTaskKey(profileId, type);
    this.activeTasks.delete(key);

    return true;
  }

  /**
   * 获取所有活动任务
   */
  getActiveTasks(): TransferTask[] {
    return Array.from(this.activeTasks.values());
  }

  /**
   * 获取待处理任务数量
   */
  getPendingCount(): number {
    return this.pendingTasks.length;
  }

  /**
   * 获取活动任务数量
   */
  getActiveCount(): number {
    return this.activeTasks.size;
  }

  /**
   * 添加状态变化回调
   */
  onTaskStatusChanged(callback: TaskStatusChangedCallback): void {
    this.taskStatusCallbacks.add(callback);
  }

  /**
   * 移除状态变化回调
   */
  offTaskStatusChanged(callback: TaskStatusChangedCallback): void {
    this.taskStatusCallbacks.delete(callback);
  }

  /**
   * 等待所有任务完成
   */
  async waitAllTasks(signal?: AbortSignal): Promise<void> {
    while ((this.pendingTasks.length > 0 || this.activeTasks.size > 0) && !signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * 队列处理循环
   */
  private async processQueueLoop(): Promise<void> {
    while (this.isRunning) {
      // 等待信号或超时
      await this.waitForSignal(1000);

      if (!this.isRunning) break;

      // 处理待处理任务
      await this.processPendingTasks();
    }
  }

  /**
   * 处理待处理任务
   */
  private async processPendingTasks(): Promise<void> {
    while (
      this.isRunning &&
      this.pendingTasks.length > 0 &&
      this.activeTasks.size < this.config.maxConcurrency
    ) {
      const task = this.pendingTasks.shift()!;

      if (task.status === 'cancelled' || task.userCancelled) {
        continue;
      }

      const key = this.getTaskKey(task.profileId, task.type);
      this.activeTasks.set(key, task);

      this.executeTask(task).catch((error) => {
        console.error('[HistoryTransferQueue] Task execution error:', error);
      });
    }
  }

  /**
   * 执行任务
   */
  private async executeTask(task: TransferTask): Promise<ClipboardContent> {
    if (task.userCancelled || task.status === 'cancelled') {
      console.log(`[HistoryTransferQueue] Task was cancelled, skipping: ${task.profileId}`);
      throw new Error('Task was cancelled');
    }

    task.status = 'running';
    task.startedTime = Date.now();
    this.notifyStatusChanged(task);

    let resultContent: ClipboardContent | undefined;

    try {
      if (task.type === 'download') {
        resultContent = await this.executeDownloadTask(task);
      } else {
        resultContent = await this.executeUploadTask(task);
      }

      task.status = 'completed';
      task.completedTime = Date.now();
      task.progress = 100;
      this.consecutiveFailures = 0;

      return resultContent;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        task.status = 'cancelled';
      } else if (task.userCancelled) {
        task.status = 'cancelled';
        console.log(`[HistoryTransferQueue] Task was cancelled by user: ${task.profileId}`);
      } else {
        task.status = 'failed';
        task.errorMessage = error instanceof Error ? error.message : 'Unknown error';
        task.failureCount++;
        this.consecutiveFailures++;

        console.error(
          `[HistoryTransferQueue] Task failed: ${task.profileId} (${task.type})`,
          error
        );

        if (
          task.failureCount < this.config.maxConsecutiveFailures &&
          this.consecutiveFailures < this.config.maxConsecutiveFailures
        ) {
          task.status = 'waitForRetry';
          setTimeout(() => {
            if (task.status === 'waitForRetry') {
              task.status = 'pending';
              task.abortController = new AbortController();
              this.pendingTasks.push(task);
              this.signalQueue();
            }
          }, this.config.retryDelayMs);
        }
      }
      throw error;
    } finally {
      this.notifyStatusChanged(task);
      const key = this.getTaskKey(task.profileId, task.type);
      this.activeTasks.delete(key);

      const resolver = this.taskCompletionResolvers.get(key);
      if (resolver) {
        this.taskCompletionResolvers.delete(key);
        if (task.status === 'completed' && resultContent) {
          resolver.resolve(resultContent);
        } else if (task.status === 'failed') {
          resolver.reject(new Error(task.errorMessage || 'Task failed'));
        } else {
          resolver.reject(new Error(`Task ${task.status}`));
        }
      }
    }
  }

  /**
   * 执行下载任务
   */
  private async executeDownloadTask(task: TransferTask): Promise<ClipboardContent> {
    if (!this.historyAPI) {
      throw new HistoryAPINotInitializedError();
    }

    console.log(`[HistoryTransferQueue] ========== Execute Download Task ==========`);
    console.log(`[HistoryTransferQueue] ProfileId: ${task.profileId}`);
    console.log(`[HistoryTransferQueue] Task created: ${new Date(task.createdTime).toISOString()}`);

    const { parseProfileId } = await import('@/utils');
    const parsed = parseProfileId(task.profileId);
    if (!parsed) {
      console.error(`[HistoryTransferQueue] Invalid profileId format: ${task.profileId}`);
      throw new Error(`Invalid profileId format: ${task.profileId}`);
    }

    console.log(
      `[HistoryTransferQueue] Parsed profileId - type: ${parsed.type}, hash: ${parsed.hash}`
    );

    const item = await this.historyStorage.getItem(parsed.hash);
    if (!item) {
      console.error(`[HistoryTransferQueue] Item not found with hash: ${parsed.hash}`);
      throw new Error(`Item not found: ${parsed.hash}`);
    }

    console.log(`[HistoryTransferQueue] Item type: ${item.type}`);
    console.log(`[HistoryTransferQueue] Item text (fileName): ${item.text}`);
    console.log(`[HistoryTransferQueue] Item hasRemoteData: ${item.hasRemoteData}`);
    console.log(`[HistoryTransferQueue] Item isLocalFileReady: ${isLocalFileReady(item)}`);

    const historyDir = getHistoryFileDir(item.type, parsed.hash);
    if (!historyDir.exists) {
      historyDir.create();
    }

    const fileName = item.dataName || (item.type !== 'Text' && item.text ? item.text : 'data');
    const destinationFile = new File(historyDir, fileName);
    const destinationUri = destinationFile.uri;

    console.log(`[HistoryTransferQueue] Destination directory: ${historyDir.uri}`);
    console.log(`[HistoryTransferQueue] Destination file: ${destinationUri}`);

    await this.historyAPI.downloadData(
      task.profileId,
      destinationUri,
      task.abortController.signal,
      (info) => {
        task.bytesTransferred = info.bytesTransferred;
        task.totalBytes = info.totalBytes;
        if (info.progress >= 0) {
          task.progress = Math.round(info.progress * 100);
        } else {
          task.progress = -1;
        }
        this.notifyStatusChanged(task);

        if (task.externalProgressReporter) {
          task.externalProgressReporter({
            progress: task.progress >= 0 ? task.progress / 100 : -1,
            bytesTransferred: task.bytesTransferred,
            totalBytes: task.totalBytes || 0,
          });
        }
      }
    );

    await this.historyStorage.updateItem(parsed.hash, {
      fileUri: destinationUri,
    });

    console.log(`[HistoryTransferQueue] Download task completed: ${task.profileId}`);

    return {
      ...historyItemToContent(item),
      fileUri: destinationUri,
    };
  }

  /**
   * 执行上传任务
   * 参照桌面客户端实现：
   * 1. 先检查服务器是否已存在该记录
   * 2. 如果存在，直接标记为已同步
   * 3. 如果不存在，执行上传
   */
  private async executeUploadTask(task: TransferTask): Promise<ClipboardContent> {
    if (!this.historyAPI) {
      throw new HistoryAPINotInitializedError();
    }

    const parsed = parseProfileId(task.profileId);
    if (!parsed) {
      throw new Error(`Invalid profileId format: ${task.profileId}`);
    }

    const item = await this.historyStorage.getItem(parsed.hash);
    if (!item) {
      throw new Error(`Item not found: ${parsed.hash}`);
    }

    // 先检查服务器上是否已存在该记录
    try {
      const existingRecord = await this.historyAPI.getRecord(
        task.profileId,
        task.abortController.signal
      );
      // 如果服务器记录已删除，视为不存在，继续上传
      if (existingRecord.isDeleted) {
        console.log(
          `[HistoryTransferQueue] Record is deleted on server, will upload: ${task.profileId}`
        );
      } else {
        // 服务器已存在且未删除，直接标记为成功
        await this.historyStorage.updateItem(parsed.hash, {
          version: existingRecord.version,
          lastModified: existingRecord.lastModified
            ? new Date(existingRecord.lastModified).getTime()
            : Date.now(),
          syncStatus: HistorySyncStatus.Synced,
        });
        console.log(
          `[HistoryTransferQueue] Record already exists on server: ${task.profileId}, marked as synced`
        );
        return historyItemToContent(item);
      }
    } catch (error) {
      // 如果是 404 错误，继续执行上传
      if (error instanceof RecordNotFoundError) {
        console.log(
          `[HistoryTransferQueue] Record not found on server, will upload: ${task.profileId}`
        );
      } else {
        throw error;
      }
    }

    // 服务器不存在，执行上传
    if (!item.fileUri) {
      throw new Error(`No file to upload: ${task.profileId}`);
    }

    const { historyItemToDto } = await import('@/utils/clipboard/convert');
    const dto = historyItemToDto(item);

    await this.historyAPI.uploadRecord(dto, item.fileUri, task.abortController.signal, (info) => {
      task.bytesTransferred = info.bytesTransferred;
      task.totalBytes = info.totalBytes;
      if (info.progress >= 0) {
        task.progress = Math.round(info.progress * 100);
      } else {
        task.progress = -1;
      }
      this.notifyStatusChanged(task);

      if (task.externalProgressReporter) {
        task.externalProgressReporter({
          progress: task.progress >= 0 ? task.progress / 100 : -1,
          bytesTransferred: task.bytesTransferred,
          totalBytes: task.totalBytes || 0,
        });
      }
    });

    await this.historyStorage.updateSyncStatus(parsed.hash, HistorySyncStatus.Synced);

    return historyItemToContent(item);
  }

  /**
   * 查找任务
   */
  private findTask(profileId: string, type: TransferType): TransferTask | undefined {
    const key = this.getTaskKey(profileId, type);
    const activeTask = this.activeTasks.get(key);
    if (activeTask) return activeTask;

    return this.pendingTasks.find((t) => t.profileId === profileId && t.type === type);
  }

  /**
   * 获取任务键
   */
  private getTaskKey(profileId: string, type: TransferType): string {
    return `${type}:${profileId}`;
  }

  /**
   * 通知状态变化
   */
  private notifyStatusChanged(task: TransferTask): void {
    for (const callback of this.taskStatusCallbacks) {
      try {
        callback(task);
      } catch (error) {
        console.error('[HistoryTransferQueue] Callback error:', error);
      }
    }
  }

  /**
   * 等待队列信号
   */
  private async waitForSignal(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.queueSignal = null;
        resolve();
      }, timeoutMs);

      this.queueSignal = {
        resolve: () => {
          clearTimeout(timeout);
          this.queueSignal = null;
          resolve();
        },
      };
    });
  }

  /**
   * 发送队列信号
   */
  private signalQueue(): void {
    if (this.queueSignal) {
      this.queueSignal.resolve();
    }
  }
}

// 单例实例
let historyTransferQueueInstance: HistoryTransferQueue | null = null;

export function getHistoryTransferQueue(): HistoryTransferQueue {
  if (!historyTransferQueueInstance) {
    historyTransferQueueInstance = new HistoryTransferQueue();
  }
  return historyTransferQueueInstance;
}

export function resetHistoryTransferQueue(): void {
  if (historyTransferQueueInstance) {
    historyTransferQueueInstance.stop();
    historyTransferQueueInstance = null;
  }
}
