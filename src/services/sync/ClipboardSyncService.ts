/**
 * ClipboardSyncService
 * 管理远程剪贴板同步（前台显示 + 后台同步）。
 *
 * 职责：
 * - 远程剪贴板获取（SignalR 或定时轮询）
 * - 处理远程剪贴板变化（哈希检测、自动下载、自动复制、历史记录）
 * - SyncManager 生命周期管理（初始化/销毁）
 * - HistorySyncService 初始化
 * - 自动上传（本地剪贴板变化时触发）
 * - 通过 useClipboardSyncServiceStore 向 UI 提供状态
 *
 * 生命周期仅由 BackgroundServiceManager 控制。
 * HomeScreen 通过 useClipboardSyncServiceStore 读取状态，通过公开方法触发用户操作。
 */

import { AppState } from 'react-native';
import { ClipboardChangeCallback, HistoryItem } from '../../types/clipboard';
import type { ServerConfig } from '../../types/api';
import { clipboardMonitor } from '../clipboard/ClipboardMonitor';
import type { ClipboardSyncState, ClipboardSyncStateListener } from './SyncState';
import { clipboardSyncState } from './SyncState';
import { configService } from '../ConfigService';
import { remoteClipboardMonitor } from './RemoteClipboardMonitor';
import type { RemoteClipboardChangedCallback } from './RemoteClipboardMonitor';
import { historyService } from '../history/HistoryService';
import { getHistoryFileUri } from '../../utils/fileStorage';
import { getHistoryTransferQueue } from '../history/HistoryTransferQueue';
import { getProfileId } from '@/utils';
import { getClipboardChangedHandler } from './ClipboardChangedHandler';

class ClipboardSyncService {
  private static instance: ClipboardSyncService | null = null;

  private _isStarted = false;
  private activeServer: ServerConfig | null = null;
  private clipboardUnsub: (() => void) | null = null;
  private historyUnsub: (() => void) | null = null;
  private transferQueueHandler:
    | ((task: import('../history/HistoryTransferQueue').TransferTask) => Promise<void>)
    | null = null;
  private readonly _remoteChangeCallback: RemoteClipboardChangedCallback = async (content) => {
    try {
      await getClipboardChangedHandler().processRemoteClipboardContent(content);
    } catch (e) {
      console.error('[ClipboardSyncService] Remote change callback error:', e);
    }
  };

  private constructor() {}

  static getInstance(): ClipboardSyncService {
    if (!ClipboardSyncService.instance) {
      ClipboardSyncService.instance = new ClipboardSyncService();
    }
    return ClipboardSyncService.instance;
  }

  public getState(): ClipboardSyncState {
    return clipboardSyncState.getState();
  }

  public subscribe(listener: ClipboardSyncStateListener): () => void {
    return clipboardSyncState.subscribe(listener);
  }

  async start(): Promise<void> {
    if (this._isStarted) return;
    this._isStarted = true;

    let bgUploadEnabled = false;
    configService.getConfig().then((cfg) => {
      bgUploadEnabled = !!(cfg?.enableBackgroundTasks && cfg?.enableBackgroundUpload);
    });
    configService.subscribe((cfg) => {
      bgUploadEnabled = !!(cfg?.enableBackgroundTasks && cfg?.enableBackgroundUpload);
    });
    clipboardMonitor.setBackgroundUploadChecker(() => bgUploadEnabled);

    const activeServer = await configService.getActiveServer();

    if (activeServer) {
      await this._initializeHistorySyncService(activeServer);
    }

    if (!activeServer) {
      clipboardSyncState.setRemoteContent(null);
      this._subscribeToClipboardChanges();
      return;
    }

    this.activeServer = activeServer;
    getClipboardChangedHandler().resetLastRemoteProfileHash();

    await this._startConnection(activeServer);

    remoteClipboardMonitor.addCallback(this._remoteChangeCallback);

    this._subscribeToClipboardChanges();

    this._subscribeToHistoryChanges();

    this._subscribeToTransferQueue();

    this._subscribeToAppState();
  }

  async stop(): Promise<void> {
    this._isStarted = false;
    this._unsubscribeFromClipboardChanges();
    this._unsubscribeFromHistoryChanges();
    this._unsubscribeFromTransferQueue();
    this._unsubscribeFromAppState();
    remoteClipboardMonitor.removeCallback(this._remoteChangeCallback);
    await this._stopConnection();

    clipboardSyncState.setRemoteContent(null);

    this.activeServer = null;
    getClipboardChangedHandler().resetHashes();
  }

  async refresh(): Promise<void> {
    const newServer = await configService.getActiveServer();
    const serverChanged = JSON.stringify(newServer) !== JSON.stringify(this.activeServer);

    if (serverChanged) {
      await this.stop();
      await this.start();
    } else if (this.activeServer) {
      const connectionActive = remoteClipboardMonitor.isConnected();
      if (!connectionActive) {
        await this._startConnection(this.activeServer);
      }
      this._subscribeToClipboardChanges();
      this._subscribeToHistoryChanges();
      this._subscribeToTransferQueue();
      this._subscribeToAppState();
    }
  }

  private _appStateSub: { remove(): void } | null = null;
  private _lastAppState: string = 'active';

  private _subscribeToAppState(): void {
    if (this._appStateSub) return;
    this._lastAppState = AppState.currentState ?? 'active';
    this._appStateSub = AppState.addEventListener('change', async (nextAppState: string) => {
      if (this._lastAppState.match(/inactive|background/) && nextAppState === 'active') {
        await this.onAppForeground();
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        await this.onAppBackground();
      }
      this._lastAppState = nextAppState;
    });
  }

  private _unsubscribeFromAppState(): void {
    this._appStateSub?.remove();
    this._appStateSub = null;
  }

  async onAppForeground(): Promise<void> {
    if (!this.activeServer) return;

    if (this.activeServer.type === 'syncclipboard') {
      if (!remoteClipboardMonitor.isSignalRConnected()) {
        await remoteClipboardMonitor.connect(this.activeServer);
      } else {
        await remoteClipboardMonitor.refresh();
      }
    } else {
      const config = await configService.getConfig();
      if (!remoteClipboardMonitor.isPolling()) {
        await remoteClipboardMonitor.connect(this.activeServer, config?.remotePollingInterval);
      }
      await remoteClipboardMonitor.refresh();
    }
  }

  async onAppBackground(): Promise<void> {
    const config = await configService.getConfig();
    const bgDownloadEnabled = config?.enableBackgroundTasks && config?.enableBackgroundDownload;

    if (!bgDownloadEnabled) {
      await remoteClipboardMonitor.disconnect();
    }
  }

  async refreshContent(): Promise<void> {
    await clipboardMonitor.triggerCheck();

    if (!this.activeServer) return;
    await remoteClipboardMonitor.refresh();
  }

  recordLocalHash(hash: string): void {
    getClipboardChangedHandler().setLastLocalProfileHash(hash);
  }

  clearSyncError(): void {
    clipboardSyncState.clearSyncError();
  }

  private async _initializeHistorySyncService(server: ServerConfig): Promise<void> {
    try {
      const config = await configService.getConfig();
      if (config?.enableHistorySync) {
        const { getHistorySyncService } = require('../history/HistorySyncService');
        await getHistorySyncService().ensureInitialized(server);
        console.log('[ClipboardSyncService] HistorySyncService initialized');
      }
    } catch (e) {
      console.error('[ClipboardSyncService] Failed to initialize HistorySyncService:', e);
    }
  }

  private async _startConnection(server: ServerConfig): Promise<void> {
    const config = await configService.getConfig();
    await remoteClipboardMonitor.connect(server, config?.remotePollingInterval);
  }

  private async _stopConnection(): Promise<void> {
    await remoteClipboardMonitor.disconnect();
  }

  private _subscribeToTransferQueue(): void {
    if (this.transferQueueHandler) return;
    const queue = getHistoryTransferQueue();

    const handler = async (task: import('../history/HistoryTransferQueue').TransferTask) => {
      if (task.type !== 'download') return;

      const currentRemote = clipboardSyncState.getState().remoteContent;
      if (!currentRemote?.profileHash) return;

      const profileId = getProfileId(currentRemote.type, currentRemote.profileHash);
      if (task.profileId !== profileId) return;

      if (
        task.status === 'running' ||
        task.status === 'pending' ||
        task.status === 'waitForRetry'
      ) {
        clipboardSyncState.setDownloadingRemote(true);
        if (task.status === 'running' && task.progress >= 0) {
          clipboardSyncState.setDownloadProgress({
            progress: task.progress / 100,
            bytesTransferred: task.bytesTransferred,
            totalBytes: task.totalBytes || 0,
          });
        }
      } else if (task.status === 'completed') {
        const fileUri = await getHistoryFileUri(
          currentRemote.type,
          currentRemote.profileHash,
          currentRemote.fileName!
        );
        if (fileUri && fileUri !== currentRemote.fileUri) {
          clipboardSyncState.updateRemoteContentFileUri(fileUri);
          const config = await configService.getConfig();
          if (config?.syncToastEnabled !== false) {
            const { ToastAndroid } = require('react-native');
            ToastAndroid.show('文件已下载', ToastAndroid.SHORT);
          }
        }
        clipboardSyncState.clearDownloadState();
      } else {
        clipboardSyncState.clearDownloadState();
      }
    };

    this.transferQueueHandler = handler;
    queue.onTaskStatusChanged(handler);
  }

  private _unsubscribeFromTransferQueue(): void {
    if (!this.transferQueueHandler) return;
    const queue = getHistoryTransferQueue();
    queue.offTaskStatusChanged(this.transferQueueHandler);
    this.transferQueueHandler = null;
    clipboardSyncState.clearDownloadState();
  }

  private _subscribeToClipboardChanges(): void {
    if (this.clipboardUnsub) return;
    const callback: ClipboardChangeCallback = (content) => {
      getClipboardChangedHandler().handleAutoUpload(content);
    };
    clipboardMonitor.addCallback(callback);
    this.clipboardUnsub = () => clipboardMonitor.removeCallback(callback);
  }

  private _unsubscribeFromClipboardChanges(): void {
    this.clipboardUnsub?.();
    this.clipboardUnsub = null;
  }

  private _subscribeToHistoryChanges(): void {
    if (this.historyUnsub) return;
    const handler = (items: HistoryItem[], action: string) => {
      if (action !== 'delete' && action !== 'clear') return;

      const currentRemote = clipboardSyncState.getState().remoteContent;
      if (!currentRemote?.profileHash) return;

      if (action === 'clear') {
        console.log('[ClipboardSyncService] History cleared, resetting remote content fileUri');
        clipboardSyncState.updateRemoteContentFileUri(undefined);
        return;
      }

      const deletedSet = new Set(items.map((i) => i.profileHash.toLowerCase()));
      if (deletedSet.has(currentRemote.profileHash.toLowerCase())) {
        console.log(
          '[ClipboardSyncService] Remote content deleted from history, resetting fileUri:',
          currentRemote.profileHash
        );
        clipboardSyncState.updateRemoteContentFileUri(undefined);
      }
    };

    historyService.addChangeCallback(handler);
    this.historyUnsub = () => historyService.removeChangeCallback(handler);
  }

  private _unsubscribeFromHistoryChanges(): void {
    this.historyUnsub?.();
    this.historyUnsub = null;
  }
}

export function getClipboardSyncService(): ClipboardSyncService {
  return ClipboardSyncService.getInstance();
}
