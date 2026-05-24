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

class RemoteClipboardMonitorTask extends LongRunningTask {
  readonly name = 'remoteClipboardMonitor';

  private _activeServer: ServerConfig | null = null;

  async start(): Promise<void> {
    const server = await configService.getActiveServer();
    if (!server) {
      clipboardSyncState.setRemoteContent(null);
      return;
    }
    this._activeServer = server;
    const config = await configService.getConfig();
    await remoteClipboardMonitor.connect(server, config?.remotePollingInterval);
  }

  async stop(): Promise<void> {
    this._activeServer = null;
    await remoteClipboardMonitor.disconnect();
  }

  isRunning(): boolean {
    return remoteClipboardMonitor.isConnected();
  }

  override async onConfigChanged(): Promise<void> {
    const newServer = await configService.getActiveServer();
    const serverChanged = JSON.stringify(newServer) !== JSON.stringify(this._activeServer);

    if (serverChanged) {
      await this.stop();
      if (newServer) {
        await this.start();
      } else {
        clipboardSyncState.setRemoteContent(null);
      }
    } else if (this._activeServer) {
      const config = await configService.getConfig();
      if (!remoteClipboardMonitor.isConnected()) {
        await remoteClipboardMonitor.connect(this._activeServer, config?.remotePollingInterval);
      }
    }
  }

  override async onBackground(): Promise<void> {
    await remoteClipboardMonitor.handleBackground();
  }

  override async onForeground(): Promise<void> {
    await remoteClipboardMonitor.handleForeground();
  }
}

export const remoteClipboardMonitorTask = new RemoteClipboardMonitorTask();
