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

import { AppState } from 'react-native';
import { ClipboardChangeCallback } from '../../types/clipboard';
import type { ClipboardContent } from '../../types/clipboard';
import { clipboardMonitor } from '../clipboard/ClipboardMonitor';
import { localClipboard } from '../clipboard/LocalClipboard';
import { clearJustUploadedHash } from './JustSetHash';
import { clipboardSyncState } from './SyncState';
import { configService } from '../ConfigService';
import { backgroundRuntimeState } from '../BackgroundRuntimeState';
import type { AppConfig } from '../../types/storage';
import { remoteClipboardMonitor } from './RemoteClipboardMonitor';
import type { RemoteClipboardChangedCallback } from './RemoteClipboardMonitor';
import { historyService } from '../history/HistoryService';
import { getHistoryTransferQueue } from '../history/HistoryTransferQueue';
import { ClipboardChangedHandler } from './ClipboardChangedHandler';
import { createHistoryChangedHandler } from './historyChangedHandler';
import { createTransferQueueChangedHandler } from './historyTransferQueueChangedHandler';

class ClipboardSyncService {
  private session: AbortController | null = null;
  private pendingLocal?: Promise<void>;
  private pendingRemote?: Promise<void>;

  private endSession(): void {
    this.session?.abort();
    this.session = null;
    if (this.pendingLocal) {
      // 上传被中断时，下次采样同一内容仍须派发给共用处理器。
      clipboardMonitor.reset();
      this.handler.resetLastLocalProfileHash();
      this.pendingLocal = undefined;
    }
    if (this.pendingRemote) {
      this.handler.resetLastRemoteProfileHash();
      this.pendingRemote = undefined;
    }
  }

  getSessionSignal(): AbortSignal | undefined {
    return this.session?.signal;
  }

  private static instance: ClipboardSyncService | null = null;

  private _isStarted = false;
  private supportsBackgroundTasks = false;
  private backgroundEnabled = false;
  private _bgUploadEnabled = false;
  private _bgDownloadEnabled = false;
  private _activeServerKey: string | null = null;
  private readonly _cleanups: Array<() => void> = [];

  private readonly handler = new ClipboardChangedHandler(async () =>
    this.effectiveConfig(await configService.getConfig())
  );

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

  async start(supportsBackgroundTasks = false): Promise<void> {
    if (this._isStarted) return;
    this._isStarted = true;
    this.supportsBackgroundTasks = supportsBackgroundTasks;
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'background' && !this.canSyncInBackground()) this.endSession();
    });
    this._cleanups.push(() => listener.remove());

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
    this.endSession();
    this._cleanups.forEach((unsub) => unsub());
    this._cleanups.length = 0;
  }

  onConfigChanged(cfg: AppConfig | null): void {
    this._applyConfig(cfg);
  }

  private canSyncInBackground(): boolean {
    return this.backgroundEnabled && !backgroundRuntimeState.isTempDisabled();
  }

  private effectiveConfig(cfg: AppConfig): AppConfig {
    if (this.supportsBackgroundTasks && cfg.enableBackgroundTasks) return cfg;
    return {
      ...cfg,
      enableBackgroundTasks: false,
      enableBackgroundUpload: false,
      enableBackgroundDownload: false,
    };
  }

  private _applyConfig(cfg: AppConfig | null): void {
    const config = cfg && this.effectiveConfig(cfg);
    this.backgroundEnabled = !!config?.enableBackgroundTasks;
    this._bgUploadEnabled = !!config?.enableBackgroundUpload;
    this._bgDownloadEnabled = !!config?.enableBackgroundDownload;

    const activeServer = cfg?.servers?.[cfg.activeServerIndex] ?? null;
    const newServerKey = activeServer ? JSON.stringify({ ...activeServer, name: undefined }) : null;
    if (newServerKey !== this._activeServerKey) {
      this.endSession();
      clearJustUploadedHash();
      clipboardSyncState.setRemoteContent(null);
      this._activeServerKey = newServerKey;
      this.handler.resetLastRemoteProfileHash();
    }
    if (AppState.currentState === 'background' && !this.canSyncInBackground()) {
      this.endSession();
    } else if (this._isStarted) {
      this.session ??= new AbortController();
    }
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
      if (hash) this.handler.setLastLocalProfileHash(hash);
    };
    localClipboard.registerRemoteCopiedCallback(callback);
    this._cleanups.push(() => localClipboard.registerRemoteCopiedCallback(null));
  }

  private _subscribeToRemoteClipboard(): void {
    const callback: RemoteClipboardChangedCallback = async (content) => {
      if (!this.session) {
        remoteClipboardMonitor.setLastContentHash(null);
        return;
      }
      const pending = this.handler.processRemoteClipboardContent(content, this.session.signal);
      this.pendingRemote = pending;
      try {
        await pending;
      } catch (e) {
        console.error('[ClipboardSyncService] Remote change callback error:', e);
      } finally {
        if (this.pendingRemote === pending) this.pendingRemote = undefined;
      }
    };
    remoteClipboardMonitor.addCallback(callback);
    this._cleanups.push(() => remoteClipboardMonitor.removeCallback(callback));
  }

  private _subscribeToClipboardChanges(): void {
    const callback: ClipboardChangeCallback = async (content) => {
      if (!this.session) {
        clipboardMonitor.reset();
        return;
      }
      const pending = this.handler.handleAutoUpload(content, this.session.signal);
      this.pendingLocal = pending;
      try {
        await pending;
      } catch (error) {
        console.error('[ClipboardSyncService] Local change callback error:', error);
      } finally {
        if (this.pendingLocal === pending) this.pendingLocal = undefined;
      }
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
      clipboardSyncState.clearUploadState();
      clipboardSyncState.clearDownloadState();
    });
  }
}

export function getClipboardSyncService(): ClipboardSyncService {
  return ClipboardSyncService.getInstance();
}
