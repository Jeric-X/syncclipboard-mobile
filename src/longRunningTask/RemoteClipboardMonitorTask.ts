/**
 * RemoteClipboardMonitorTask
 * 持续任务：管理远程剪贴板监听（RemoteClipboardMonitor）的连接生命周期。
 *
 * 职责：
 * - 连接/断开 remoteClipboardMonitor（SignalR 或轮询）
 * - onConfigChanged 检测服务器变更并重连
 * - onBackground / onForeground 控制后台断开与前台恢复
 *
 * 注册为 keepAlive = true，后台是否断开连接由 onBackground 内部逻辑决定。
 * 生命周期由 LongRunningTaskManager 统一管理。
 */

import { LongRunningTask } from './LongRunningTask';
import type { ServerConfig } from '../types/api';
import { remoteClipboardMonitor } from '../services/sync/RemoteClipboardMonitor';
import { configService } from '../services/ConfigService';
import { clipboardSyncState } from '../services/sync/SyncState';

export class RemoteClipboardMonitorTask extends LongRunningTask {
  readonly name = 'remoteClipboardMonitor';

  private _started = false;
  private lifecycle = 0;
  private _activeServer: ServerConfig | null = null;
  private _activePollingInterval: number | undefined = undefined;

  async start(): Promise<void> {
    if (this._started) return;
    // 任务生命周期与当前是否有服务器分离，以便无服务器时仍能接收配置变化。
    this._started = true;
    const lifecycle = ++this.lifecycle;
    const server = await configService.getActiveServer();
    const config = await configService.getConfig();
    if (lifecycle !== this.lifecycle) return;
    if (!server) {
      this._activeServer = null;
      this._activePollingInterval = config?.remotePollingInterval;
      clipboardSyncState.setRemoteContent(null);
      return;
    }
    this._activeServer = server;
    this._activePollingInterval = config?.remotePollingInterval;
    this.runInBackground(() => remoteClipboardMonitor.connect());
  }

  async stop(): Promise<void> {
    this.lifecycle++;
    this._started = false;
    this._activeServer = null;
    this._activePollingInterval = undefined;
    await remoteClipboardMonitor.disconnect();
  }

  isRunning(): boolean {
    return this._started;
  }

  override async onConfigChanged(): Promise<void> {
    if (!this._started) return;
    const lifecycle = this.lifecycle;
    const newServer = await configService.getActiveServer();
    const config = await configService.getConfig();
    if (lifecycle !== this.lifecycle) return;
    const newPollingInterval = config?.remotePollingInterval;

    const serverChanged = JSON.stringify(newServer) !== JSON.stringify(this._activeServer);
    const pollingIntervalChanged = newPollingInterval !== this._activePollingInterval;

    if (!newServer) {
      this._activeServer = null;
      this._activePollingInterval = newPollingInterval;
      await remoteClipboardMonitor.disconnect();
      clipboardSyncState.setRemoteContent(null);
      return;
    }

    if (serverChanged || pollingIntervalChanged) {
      await remoteClipboardMonitor.disconnect();
      if (lifecycle !== this.lifecycle) return;
      this._activeServer = newServer;
      this._activePollingInterval = newPollingInterval;
      this.runInBackground(() => remoteClipboardMonitor.connect());
    } else if (!remoteClipboardMonitor.isConnected()) {
      this.runInBackground(() => remoteClipboardMonitor.connect());
    }
  }

  override async onBackground(): Promise<void> {
    await remoteClipboardMonitor.handleBackground();
  }

  override async onForeground(): Promise<void> {
    if (this._started) this.runInBackground(() => remoteClipboardMonitor.handleForeground());
  }

  private runInBackground(operation: () => Promise<void>): void {
    void operation().catch((error) => {
      console.error('[RemoteClipboardMonitorTask] Remote operation failed:', error);
      clipboardSyncState.setSyncError({ title: '服务器连接断开' });
    });
  }
}

export const remoteClipboardMonitorTask = new RemoteClipboardMonitorTask();
