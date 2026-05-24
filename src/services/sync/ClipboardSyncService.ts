/**
 * ClipboardSyncService
 * 管理远程剪贴板同步的回调订阅与本地自动上传。
 *
 * 职责：
 * - 订阅远程剪贴板变化通知（哈希检测、自动下载、自动复制、历史记录）
 * - 自动上传（本地剪贴板变化时触发）
 * - 通过 useClipboardSyncServiceStore 向 UI 提供状态
 *
 * 远程连接生命周期由 RemoteClipboardMonitorTask 管理。
 * 生命周期由 LongRunningTaskManager 统一控制。
 */

import { ClipboardChangeCallback } from '../../types/clipboard';
import type { ClipboardContent } from '../../types/clipboard';
import { clipboardMonitor } from '../clipboard/ClipboardMonitor';
import { localClipboard } from '../clipboard/LocalClipboard';
import { clipboardSyncState } from './SyncState';
import { configService } from '../ConfigService';
import type { AppConfig } from '../../types/storage';
import { remoteClipboardMonitor } from './RemoteClipboardMonitor';
import type { RemoteClipboardChangedCallback } from './RemoteClipboardMonitor';
import { historyService } from '../history/HistoryService';
import { getHistoryTransferQueue } from '../history/HistoryTransferQueue';
import { getClipboardChangedHandler } from './ClipboardChangedHandler';
import { createHistoryChangedHandler } from './historyChangedHandler';
import { createTransferQueueChangedHandler } from './historyTransferQueueChangedHandler';

class ClipboardSyncService {
  private static instance: ClipboardSyncService | null = null;

  private _isStarted = false;
  private _bgUploadEnabled = false;
  private _bgDownloadEnabled = false;
  private readonly _cleanups: Array<() => void> = [];

  private constructor() {}

  static getInstance(): ClipboardSyncService {
    if (!ClipboardSyncService.instance) {
      ClipboardSyncService.instance = new ClipboardSyncService();
    }
    return ClipboardSyncService.instance;
  }

  public isStarted(): boolean {
    return this._isStarted;
  }

  async start(): Promise<void> {
    if (this._isStarted) return;
    this._isStarted = true;

    const cfg = await configService.getConfig();
    this._applyConfig(cfg);
    this._registerBgUploadChecker();
    this._registerBgDownloadChecker();
    this._registerRemoteCopiedCallback();
    this._subscribeToRemoteClipboard();
    this._subscribeToClipboardChanges();
    this._subscribeToHistoryChanges();
    this._subscribeToTransferQueue();
  }

  async stop(): Promise<void> {
    this._isStarted = false;
    this._cleanups.forEach((unsub) => unsub());
    this._cleanups.length = 0;
  }

  onConfigChanged(cfg: AppConfig | null): void {
    this._applyConfig(cfg);
  }

  private _applyConfig(cfg: AppConfig | null): void {
    this._bgUploadEnabled = !!cfg?.enableBackgroundUpload;
    this._bgDownloadEnabled = !!cfg?.enableBackgroundDownload;
  }

  clearSyncError(): void {
    clipboardSyncState.clearSyncError();
  }

  private _registerBgUploadChecker(): void {
    const checker = () => this._bgUploadEnabled;
    clipboardMonitor.addBackgroundRunningChecker(checker);
    this._cleanups.push(() => clipboardMonitor.removeBackgroundRunningChecker(checker));
  }

  private _registerBgDownloadChecker(): void {
    const checker = () => this._bgDownloadEnabled;
    remoteClipboardMonitor.addBackgroundRunningChecker(checker);
    this._cleanups.push(() => remoteClipboardMonitor.removeBackgroundRunningChecker(checker));
  }

  private _registerRemoteCopiedCallback(): void {
    const callback = (content: ClipboardContent) => {
      const hash = content.profileHash || content.text || null;
      if (hash) getClipboardChangedHandler().setLastLocalProfileHash(hash);
    };
    localClipboard.registerRemoteCopiedCallback(callback);
    this._cleanups.push(() => localClipboard.registerRemoteCopiedCallback(null));
  }

  private _subscribeToRemoteClipboard(): void {
    const callback: RemoteClipboardChangedCallback = async (content) => {
      try {
        await getClipboardChangedHandler().processRemoteClipboardContent(content);
      } catch (e) {
        console.error('[ClipboardSyncService] Remote change callback error:', e);
      }
    };
    remoteClipboardMonitor.addCallback(callback);
    this._cleanups.push(() => remoteClipboardMonitor.removeCallback(callback));
  }

  private _subscribeToClipboardChanges(): void {
    const callback: ClipboardChangeCallback = (content) => {
      getClipboardChangedHandler().handleAutoUpload(content);
    };
    clipboardMonitor.addCallback(callback);
    this._cleanups.push(() => clipboardMonitor.removeCallback(callback));
  }

  private _subscribeToHistoryChanges(): void {
    const handler = createHistoryChangedHandler();
    historyService.addChangeCallback(handler);
    this._cleanups.push(() => historyService.removeChangeCallback(handler));
  }

  private _subscribeToTransferQueue(): void {
    const queue = getHistoryTransferQueue();
    const handler = createTransferQueueChangedHandler();
    queue.onTaskStatusChanged(handler);
    this._cleanups.push(() => {
      queue.offTaskStatusChanged(handler);
      clipboardSyncState.clearDownloadState();
    });
  }
}

export function getClipboardSyncService(): ClipboardSyncService {
  return ClipboardSyncService.getInstance();
}
