/**
 * Remote Clipboard Monitor
 * 远程剪贴板变化监听服务 - 管理低延迟事件源或定时轮询，
 * 并始终通过 HTTP API 获取权威状态后通知上层（ClipboardSyncService）。
 */

import type { ClipboardContent } from '../../types/clipboard';
import type { ServerConfig } from '../../types/api';
import { setTimer, clearTimer } from 'native-timer';
import { getAPIClient } from '../ClientFactory';
import { profileDtoToContent } from '../../utils/clipboard/convert';
import { clipboardSyncState } from './SyncState';
import { configService } from '../ConfigService';
import { DedupedOperation } from '../../utils/DedupedOperation';
import type {
  RemoteEventSource,
  RemoteEventSourceConnectionState,
  RemoteProfileChangeHint,
} from './RemoteEventSource';
import { SignalRRemoteEventSource } from './SignalRRemoteEventSource';
import { PushEventSource } from './PushEventSource';
import { selectBackgroundRemoteTransportPolicy } from './RemoteTransportPolicy';

/** 远程剪贴板变化回调：仅在内容哈希变化时触发 */
export type RemoteClipboardChangedCallback = (content: ClipboardContent) => void;

export type RemoteEventSourceFactory = (server: ServerConfig) => RemoteEventSource;

const createSignalRRemoteEventSource: RemoteEventSourceFactory = (server) =>
  new SignalRRemoteEventSource(server);
const createPushRemoteEventSource: RemoteEventSourceFactory = (server) =>
  new PushEventSource(server);

export class RemoteClipboardMonitor {
  private static _instance: RemoteClipboardMonitor | null = null;

  private callbacks = new Set<RemoteClipboardChangedCallback>();
  private pollingTag: string | null = null;
  private _eventSource: RemoteEventSource | null = null;
  private _eventSourceCleanups: Array<() => void> = [];
  private _pushEventSource: RemoteEventSource | null = null;
  private _pushEventSourceCleanups: Array<() => void> = [];
  private readonly _pushRegistrationStateListeners = new Set<(active: boolean) => void>();
  /** 上次触发回调时的内容哈希，用于过滤重复通知 */
  private _lastContentHash: string | null = null;
  /** 对 fetchLatest 进行去重：并发调用共享同一次请求；配置变更时通过 abort() 取消 */
  private readonly _fetchOp = new DedupedOperation<true, ClipboardContent>(() => true);
  /**
   * 注入的后台运行检测函数集合。
   * 只要任意一个函数返回 true，后台时就继续监听而不断开。
   */
  private readonly _bgRunningCheckers: Set<() => boolean> = new Set();

  constructor(
    private readonly _createRemoteEventSource: RemoteEventSourceFactory = createSignalRRemoteEventSource,
    private readonly _createPushEventSource: RemoteEventSourceFactory = createPushRemoteEventSource
  ) {}

  static getInstance(): RemoteClipboardMonitor {
    if (!this._instance) this._instance = new RemoteClipboardMonitor();
    return this._instance;
  }

  addCallback(callback: RemoteClipboardChangedCallback): void {
    this.callbacks.add(callback);
  }

  removeCallback(callback: RemoteClipboardChangedCallback): void {
    this.callbacks.delete(callback);
  }

  /**
   * 添加一个“后台运行检测函数”。
   * 只要任意一个检测函数返回 true，进入后台时就不断开连接。
   */
  addBackgroundRunningChecker(fn: () => boolean): void {
    this._bgRunningCheckers.add(fn);
  }

  removeBackgroundRunningChecker(fn: () => boolean): void {
    this._bgRunningCheckers.delete(fn);
  }

  /** 订阅 Push 注册状态，供后台功耗策略即时响应 token 注册和失效。 */
  addPushRegistrationStateListener(listener: (active: boolean) => void): () => void {
    this._pushRegistrationStateListeners.add(listener);
    return () => this._pushRegistrationStateListeners.delete(listener);
  }

  private _isBgRunningEnabled(): boolean {
    return Array.from(this._bgRunningCheckers).some((fn) => fn());
  }

  /**
   * App 进入后台时由外部（RemoteClipboardMonitorTask.onBackground）调用。
   * Push 注册可用时只断开 SignalR；否则保留原有 SignalR 后台行为。
   */
  async handleBackground(): Promise<void> {
    const policy = selectBackgroundRemoteTransportPolicy({
      backgroundRemoteSyncEnabled: this._isBgRunningEnabled(),
      pushRegistrationActive: this.isPushConnected(),
    });

    if (policy === 'disconnect-all') {
      console.debug(
        '[RemoteClipboardMonitor] Background remote sync disabled; disconnecting transports'
      );
      await this.disconnect();
    } else if (policy === 'push-only') {
      console.debug(
        '[RemoteClipboardMonitor] Push registration active; disconnecting SignalR in background'
      );
      await this._disconnectSignalR();
    } else {
      console.debug(
        '[RemoteClipboardMonitor] Push unavailable; preserving SignalR background behavior'
      );
    }
  }

  /**
   * 同步上次已知的内容哈希。
   * Service 在主动拉取（fetchRemoteClipboard）后调用，使监听器跳过重复通知。
   */
  setLastContentHash(hash: string | null): void {
    this._lastContentHash = hash;
  }

  private notifyCallbacks(content: ClipboardContent): void {
    this.callbacks.forEach((cb) => cb(content));
  }

  /**
   * 建立远程监听（SignalR 或轮询）。
   * 不触发初始获取，由调用方负责。
   */
  async connect(): Promise<void> {
    const server = await configService.getActiveServer();
    if (!server) return;
    const config = await configService.getConfig();
    if (server.type === 'syncclipboard') {
      await Promise.all([this._connectSignalR(server), this._connectPush(server)]);
    } else {
      this._startPolling(config?.remotePollingInterval);
    }
  }

  /**
   * 前台恢复时调用：确保连接并立即触发一次内容拉取。
   * 无需区分服务器类型，内部统一处理。
   */
  async resumeAndRefresh(): Promise<void> {
    // connect() is idempotent and also retries an optional push registration
    // that may have failed because the token, server, or network was unavailable.
    await this.connect();
    await this.refresh();
  }

  /**
   * App 返回前台时由外部（RemoteClipboardMonitorTask.onForeground）调用。
   * 重新连接并刷新。
   */
  async handleForeground(): Promise<void> {
    await this.resumeAndRefresh();
  }

  async disconnect(): Promise<void> {
    this._fetchOp.abort();
    this._lastContentHash = null;
    this._stopPolling();
    await Promise.all([this._disconnectSignalR(), this._disconnectPush()]);
  }

  isPolling(): boolean {
    return !!this.pollingTag;
  }

  /**
   * 检查 SignalR 是否已连接（同时验证底层客户端状态）。
   */
  isSignalRConnected(): boolean {
    if (!this._eventSource) return false;
    try {
      return this._eventSource.isConnected();
    } catch {
      return false;
    }
  }

  isConnected(): boolean {
    return this.isPolling() || this.isSignalRConnected() || this.isPushConnected();
  }

  isPushConnected(): boolean {
    return this._pushEventSource?.isConnected() ?? false;
  }

  private readonly _eventSourceStateCallback = (state: RemoteEventSourceConnectionState): void => {
    if (state === 'DISCONNECTED') {
      clipboardSyncState.setSyncError({ title: '服务器连接断开' });
    } else if (state === 'CONNECTED') {
      clipboardSyncState.clearSyncError();
      this.refresh().catch((e) => {
        console.error('[RemoteClipboardMonitor] Post-reconnect refresh failed:', e);
      });
    }
  };

  private readonly _remoteProfileChangeCallback = (hint: RemoteProfileChangeHint): void => {
    if (hint.hash && hint.hash === this._lastContentHash) {
      console.debug('[RemoteClipboardMonitor] Ignoring already-known remote profile hint');
      return;
    }

    console.debug(
      '[RemoteClipboardMonitor] Remote profile change hint received; refreshing authoritative state'
    );
    void this.refresh();
  };

  private readonly _pushEventSourceStateCallback = (): void => {
    this._notifyPushRegistrationState();
  };

  private _startPolling(interval?: number): void {
    if (this.pollingTag) return;
    try {
      const pollingInterval = interval ?? 3000;
      this.pollingTag = setTimer(
        () => {
          this.fetchLatest().catch(() => {});
        },
        pollingInterval,
        'remote_sync_poll'
      );
      console.log('[RemoteClipboardMonitor] Polling started, interval:', pollingInterval);
    } catch (e) {
      console.error('[RemoteClipboardMonitor] Failed to start polling:', e);
    }
  }

  /**
   * 立即主动拉取一次远程剪贴板并通知回调。
   * 与轮询逻辑复用同一实现，会自动跳过内容未变化的情况。
   */
  async refresh(): Promise<void> {
    try {
      await this.fetchLatest();
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      console.error('[RemoteClipboardMonitor] Failed to fetch latest:', e);
      clipboardSyncState.setSyncError({ title: '服务器连接断开' });
    }
  }

  /**
   * 主动拉取最新远程剪贴板内容并返回。
   * 仅在内容哈希变化时触发回调（与 refresh 行为一致），但无论是否变化都返回内容。
   * @param signal 可选的取消信号
   * @returns 最新的远程剪贴板内容
   * @throws 无服务器连接或拉取失败时抛出异常
   */
  async fetchLatest(signal?: AbortSignal): Promise<ClipboardContent> {
    return this._fetchOp.execute(true, undefined, signal ?? null, async (sig) => {
      const apiClient = await getAPIClient();
      const profile = await apiClient.getClipboard(sig);
      if (!profile) throw new Error('No clipboard data returned');
      const content: ClipboardContent = profileDtoToContent(profile);
      const hash = content.profileHash || content.text;
      if (hash !== this._lastContentHash) {
        this._lastContentHash = hash;
        this.notifyCallbacks(content);
      }
      clipboardSyncState.clearSyncError();
      return content;
    });
  }

  private _stopPolling(): void {
    if (!this.pollingTag) return;
    try {
      clearTimer(this.pollingTag);
    } catch {}
    this.pollingTag = null;
    console.log('[RemoteClipboardMonitor] Polling stopped');
  }

  private async _connectSignalR(server: ServerConfig): Promise<void> {
    if (this._eventSource) return;
    let eventSource: RemoteEventSource | null = null;

    try {
      eventSource = this._createRemoteEventSource(server);
      this._eventSource = eventSource;
      this._eventSourceCleanups = [];
      this._eventSourceCleanups.push(
        eventSource.onProfileChanged(this._remoteProfileChangeCallback)
      );
      if (eventSource.onConnectionStateChanged) {
        this._eventSourceCleanups.push(
          eventSource.onConnectionStateChanged(this._eventSourceStateCallback)
        );
      }

      await eventSource.connect();
      if (this._eventSource !== eventSource) return;
      console.log('[RemoteClipboardMonitor] SignalR connected');
    } catch (e) {
      if (eventSource && this._eventSource === eventSource) {
        this._eventSource = null;
        this._clearEventSourceSubscriptions();
      }
      await eventSource?.disconnect().catch(() => {});
      console.error('[RemoteClipboardMonitor] Failed to connect SignalR:', e);
      clipboardSyncState.setSyncError({ title: '服务器连接断开' });
    }
  }

  private async _disconnectSignalR(): Promise<void> {
    const eventSource = this._eventSource;
    if (!eventSource) return;
    this._eventSource = null;
    this._clearEventSourceSubscriptions();
    try {
      await eventSource.disconnect();
      console.log('[RemoteClipboardMonitor] SignalR disconnected');
    } catch {}
  }

  private async _connectPush(server: ServerConfig): Promise<void> {
    if (this._pushEventSource) {
      await this._pushEventSource.connect();
      return;
    }
    let eventSource: RemoteEventSource | null = null;

    try {
      eventSource = this._createPushEventSource(server);
      this._pushEventSource = eventSource;
      this._pushEventSourceCleanups = [
        eventSource.onProfileChanged(this._remoteProfileChangeCallback),
      ];
      if (eventSource.onConnectionStateChanged) {
        this._pushEventSourceCleanups.push(
          eventSource.onConnectionStateChanged(this._pushEventSourceStateCallback)
        );
      }
      await eventSource.connect();
      if (this._pushEventSource !== eventSource) return;
      this._notifyPushRegistrationState();
      console.debug(
        eventSource.isConnected()
          ? '[RemoteClipboardMonitor] Push event source registered'
          : '[RemoteClipboardMonitor] Push event source unavailable; SignalR remains active'
      );
    } catch (error) {
      if (eventSource && this._pushEventSource === eventSource) {
        this._pushEventSource = null;
        this._clearPushEventSourceSubscriptions();
      }
      await eventSource?.disconnect().catch(() => {});
      this._notifyPushRegistrationState();
      console.warn('[RemoteClipboardMonitor] Push event source setup failed:', error);
    }
  }

  private async _disconnectPush(): Promise<void> {
    const eventSource = this._pushEventSource;
    if (!eventSource) return;
    this._pushEventSource = null;
    this._clearPushEventSourceSubscriptions();
    this._notifyPushRegistrationState();
    try {
      await eventSource.disconnect();
      console.debug('[RemoteClipboardMonitor] Push event source disconnected');
    } catch (error) {
      console.warn('[RemoteClipboardMonitor] Failed to disconnect push event source:', error);
    }
  }

  private _clearEventSourceSubscriptions(): void {
    const cleanups = this._eventSourceCleanups;
    this._eventSourceCleanups = [];
    cleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch {}
    });
  }

  private _clearPushEventSourceSubscriptions(): void {
    const cleanups = this._pushEventSourceCleanups;
    this._pushEventSourceCleanups = [];
    cleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch {}
    });
  }

  private _notifyPushRegistrationState(): void {
    const active = this.isPushConnected();
    this._pushRegistrationStateListeners.forEach((listener) => {
      try {
        listener(active);
      } catch (error) {
        console.error('[RemoteClipboardMonitor] Push state listener failed:', error);
      }
    });
  }
}

export const remoteClipboardMonitor = RemoteClipboardMonitor.getInstance();
