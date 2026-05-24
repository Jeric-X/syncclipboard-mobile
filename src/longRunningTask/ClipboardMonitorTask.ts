/**
 * ClipboardMonitorTask
 * 持续任务：管理剪贴板监控服务的生命周期。
 *
 * 职责：
 * - 启动/停止 clipboardMonitor（始终运行，UI 需要感知本地剪贴板变化）
 * - onConfigChanged 读取 localPollingInterval 并调用 clipboardMonitor.updatePollingInterval()
 * - onBackground / onForeground 通知 clipboardMonitor 暂停/恢复轮询
 *
 * 注意：注册为 keepAlive = true，后台自动停止逻辑不影响此任务；
 *      后台时是否暂停轮询由 ClipboardMonitor.handleBackground() 内部逻辑决定。
 * 生命周期由 LongRunningTaskManager 统一管理。
 */

import { LongRunningTask } from './LongRunningTask';
import { clipboardMonitor } from '../services/clipboard/ClipboardMonitor';
import { configService } from '../services/ConfigService';

class ClipboardMonitorTask extends LongRunningTask {
  readonly name = 'clipboardMonitor';

  async start(): Promise<void> {
    if (!clipboardMonitor.isActive()) {
      await clipboardMonitor.start();
      await clipboardMonitor.triggerCheck();
    }
    await this._applyPollingInterval();
  }

  override async onConfigChanged(): Promise<void> {
    await this._applyPollingInterval();
  }

  override onBackground(): Promise<void> {
    clipboardMonitor.handleBackground();
    return Promise.resolve();
  }

  override onForeground(): Promise<void> {
    clipboardMonitor.handleForeground();
    return Promise.resolve();
  }

  private async _applyPollingInterval(): Promise<void> {
    try {
      const config = await configService.getConfig();
      clipboardMonitor.updatePollingInterval(config.localPollingInterval ?? 1000);
    } catch (e) {
      console.error('[ClipboardMonitorTask] Failed to apply polling interval:', e);
    }
  }

  async stop(): Promise<void> {
    clipboardMonitor.stop();
  }

  isRunning(): boolean {
    return clipboardMonitor.isActive();
  }
}

export const clipboardMonitorTask = new ClipboardMonitorTask();
