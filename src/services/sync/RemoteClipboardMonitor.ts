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
import { profileDtoToContent } from '../../utils/clipboard/dtoConvert';

/** 远程剪贴板变化回调：仅在内容哈希变化时触发 */
export type RemoteClipboardChangedCallback = (content: ClipboardContent) => void;

class RemoteClipboardMonitor {
  private static _instance: RemoteClipboardMonitor | null = null;

  private callbacks = new Set<RemoteClipboardChangedCallback>();
  private pollingTag: string | null = null;
  private _signalRConnected = false;
  private _server: ServerConfig | null = null;
  /** 上次触发回调时的内容哈希，用于过滤重复通知 */
  private _lastContentHash: string | null = null;

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
  async connect(server: ServerConfig, pollingInterval?: number): Promise<void> {
    this._server = server;
    if (server.type === 'syncclipboard') {
      await this._connectSignalR(server);
    } else {
      this._startPolling(pollingInterval);
    }
  }

  async disconnect(): Promise<void> {
    this._server = null;
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
      const hash = content.profileHash || content.text || '';
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
          this._fetchAndNotify().catch(() => {});
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
    await this._fetchAndNotify();
  }

  private async _fetchAndNotify(): Promise<void> {
    if (!this._server) return;
    try {
      const apiClient = await getAPIClient();
      const profile = await apiClient.getClipboard();
      if (!profile) return;
      const content: ClipboardContent = profileDtoToContent(profile);
      const hash = content.profileHash || content.text || '';
      if (hash === this._lastContentHash) return;
      this._lastContentHash = hash;
      this.notifyCallbacks(content);
    } catch (e) {
      console.error('[RemoteClipboardMonitor] Failed to fetch and notify:', e);
    }
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
    } catch (e) {
      console.error('[RemoteClipboardMonitor] Failed to connect SignalR:', e);
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
