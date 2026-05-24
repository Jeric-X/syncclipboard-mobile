/**
 * Remote Clipboard Monitor
 * 远程剪贴板变化监听服务 - 管理 SignalR 或定时轮询两种模式，
 * 通过发布订阅将变化事件通知给上层（ClipboardSyncService）。
 */

import type { ClipboardContent } from '../../types/clipboard';
import type { ServerConfig } from '../../types/api';
import type { ProfileChangedEvent } from 'signalr-client';
import { getSignalRClient } from 'signalr-client';
import { setTimer, clearTimer } from 'native-timer';
import { getAPIClient } from '../ClientFactory';
import { profileDtoToContent } from '../../utils/clipboard/convert';
import { clipboardSyncState } from './SyncState';
import { configService } from '../ConfigService';

/** 远程剪贴板变化回调：仅在内容哈希变化时触发 */
export type RemoteClipboardChangedCallback = (content: ClipboardContent) => void;

class RemoteClipboardMonitor {
  private static _instance: RemoteClipboardMonitor | null = null;

  private callbacks = new Set<RemoteClipboardChangedCallback>();
  private pollingTag: string | null = null;
  private _signalRConnected = false;
  /** 上次触发回调时的内容哈希，用于过滤重复通知 */
  private _lastContentHash: string | null = null;
  /**
   * 注入的后台运行检测函数集合。
   * 只要任意一个函数返回 true，后台时就继续监听而不断开。
   */
  private readonly _bgRunningCheckers: Set<() => boolean> = new Set();

  private constructor() {}

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

  private _isBgRunningEnabled(): boolean {
    return Array.from(this._bgRunningCheckers).some((fn) => fn());
  }

  /**
   * App 进入后台时由外部（RemoteClipboardMonitorTask.onBackground）调用。
   * 若无任何 checker 返回 true，则断开连接。
   */
  async handleBackground(): Promise<void> {
    if (!this._isBgRunningEnabled()) {
      await this.disconnect();
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
      await this._connectSignalR(server);
    } else {
      this._startPolling(config?.remotePollingInterval);
    }
  }

  /**
   * 前台恢复时调用：确保连接并立即触发一次内容拉取。
   * 若未连接则先重连，若已连接则直接刷新。
   * 无需区分服务器类型，内部统一处理。
   */
  async resumeAndRefresh(): Promise<void> {
    if (!this.isConnected()) {
      await this.connect();
    }
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
    this._lastContentHash = null;
    this._stopPolling();
    await this._disconnectSignalR();
  }

  isPolling(): boolean {
    return !!this.pollingTag;
  }

  /**
   * 检查 SignalR 是否已连接（同时验证底层客户端状态）。
   */
  isSignalRConnected(): boolean {
    if (!this._signalRConnected) return false;
    try {
      return getSignalRClient().isConnected();
    } catch {
      return false;
    }
  }

  isConnected(): boolean {
    return this.isPolling() || this.isSignalRConnected();
  }

  private readonly _signalREventCallback = (event: ProfileChangedEvent): void => {
    try {
      const profile = {
        type: event.type as 'Text' | 'Image' | 'File' | 'Group',
        hash: event.hash,
        text: event.text,
        hasData: event.hasData,
        dataName: event.dataName,
        size: event.size,
      };
      const content: ClipboardContent = profileDtoToContent(profile);
      const hash = content.profileHash || content.text;
      if (hash === this._lastContentHash) return;
      this._lastContentHash = hash;
      this.notifyCallbacks(content);
    } catch (e) {
      console.error('[RemoteClipboardMonitor] Failed to convert SignalR event:', e);
    }
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
      console.error('[RemoteClipboardMonitor] Failed to fetch latest:', e);
      const errorMessage = e instanceof Error ? e.message : '获取远程剪贴板失败';
      clipboardSyncState.setSyncError({ title: '同步失败', message: errorMessage });
    }
  }

  /**
   * 主动拉取最新远程剪贴板内容并返回。
   * 仅在内容哈希变化时触发回调（与 refresh 行为一致），但无论是否变化都返回内容。
   * @returns 最新的远程剪贴板内容
   * @throws 无服务器连接或拉取失败时抛出异常
   */
  async fetchLatest(): Promise<ClipboardContent> {
    const apiClient = await getAPIClient();
    const profile = await apiClient.getClipboard();
    if (!profile) throw new Error('No clipboard data returned');
    const content: ClipboardContent = profileDtoToContent(profile);
    const hash = content.profileHash || content.text;
    if (hash !== this._lastContentHash) {
      this._lastContentHash = hash;
      this.notifyCallbacks(content);
      clipboardSyncState.clearSyncError();
    }
    return content;
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
    if (this._signalRConnected) return;
    try {
      const client = getSignalRClient();
      client.onRemoteClipboardChanged(this._signalREventCallback);
      await client.connect(server);
      this._signalRConnected = true;
      console.log('[RemoteClipboardMonitor] SignalR connected');
      await this.refresh().catch((e) => {
        console.error('[RemoteClipboardMonitor] Initial refresh failed:', e);
      });
    } catch (e) {
      console.error('[RemoteClipboardMonitor] Failed to connect SignalR:', e);
      const errorMessage = e instanceof Error ? e.message : '无法连接到服务器';
      clipboardSyncState.setSyncError({ title: '连接失败', message: errorMessage });
    }
  }

  private async _disconnectSignalR(): Promise<void> {
    if (!this._signalRConnected) return;
    this._signalRConnected = false;
    try {
      const client = getSignalRClient();
      client.offRemoteClipboardChanged(this._signalREventCallback);
      await client.disconnect();
      console.log('[RemoteClipboardMonitor] SignalR disconnected');
    } catch {}
  }
}

export const remoteClipboardMonitor = RemoteClipboardMonitor.getInstance();
