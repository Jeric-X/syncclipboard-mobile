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
import { AppState } from 'react-native';

export class RemoteClipboardMonitorTask extends LongRunningTask {
  readonly name = 'remoteClipboardMonitor';

  private _started = false;
  private _activeServer: ServerConfig | null = null;
  private _activePollingInterval: number | undefined = undefined;
  private _inBackground = AppState.currentState === 'background';

  async start(): Promise<void> {
    if (this._started) return;
    // 任务生命周期与当前是否有服务器分离，以便无服务器时仍能接收配置变化。
    this._started = true;
    const server = await configService.getActiveServer();
    if (!server) {
      this._activeServer = null;
      this._activePollingInterval = (await configService.getConfig())?.remotePollingInterval;
      clipboardSyncState.setRemoteContent(null);
      return;
    }
    const config = await configService.getConfig();
    this._activeServer = server;
    this._activePollingInterval = config?.remotePollingInterval;
    await this._resumeForCurrentLifecycle();
  }

  async stop(): Promise<void> {
    this._started = false;
    this._activeServer = null;
    this._activePollingInterval = undefined;
    await remoteClipboardMonitor.disconnect();
  }

  isRunning(): boolean {
    return this._started;
  }

  override async onConfigChanged(): Promise<void> {
    const newServer = await configService.getActiveServer();
    const config = await configService.getConfig();
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
      this._activeServer = newServer;
      this._activePollingInterval = newPollingInterval;
      await this._resumeForCurrentLifecycle();
    } else if (!remoteClipboardMonitor.isConnected()) {
      await this._resumeForCurrentLifecycle();
    }
  }

  override async onBackground(): Promise<void> {
    this._inBackground = true;
    await remoteClipboardMonitor.handleBackground();
  }

  override async onForeground(): Promise<void> {
    this._inBackground = false;
    await remoteClipboardMonitor.handleForeground();
  }

  private async _resumeForCurrentLifecycle(): Promise<void> {
    await remoteClipboardMonitor.resumeAndRefresh();
    if (this._inBackground) await remoteClipboardMonitor.handleBackground();
  }
}

export const remoteClipboardMonitorTask = new RemoteClipboardMonitorTask();
