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

import { Platform } from 'react-native';
import { useLocalClipboardStore } from '../stores/localClipboardStore';
import { LongRunningTask } from './LongRunningTask';
import { clipboardMonitor } from '../services/clipboard/ClipboardMonitor';
import { configService } from '../services/ConfigService';

class ClipboardMonitorTask extends LongRunningTask {
  readonly name = 'clipboardMonitor';
  private sampleGeneration = 0;

  async start(): Promise<void> {
    if (Platform.OS === 'ios') {
      // 系统可能显示粘贴权限弹窗；远端连接和后台停止不应等待它返回。
      const generation = ++this.sampleGeneration;
      useLocalClipboardStore.setState({ currentContent: null });
      void clipboardMonitor.start().then(() => {
        if (generation === this.sampleGeneration && clipboardMonitor.isActive()) {
          useLocalClipboardStore.setState({ currentContent: clipboardMonitor.getLastContent() });
        }
      });
      return;
    }
    if (!clipboardMonitor.isActive()) {
      await clipboardMonitor.start();
      await clipboardMonitor.triggerCheck();
    }
    await this._applyPollingInterval();
  }

  override async onConfigChanged(): Promise<void> {
    if (Platform.OS === 'ios') return;
    await this._applyPollingInterval();
    await clipboardMonitor.refreshListeningMode();
  }

  override onBackground(): Promise<void> {
    return clipboardMonitor.handleBackground();
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
    if (Platform.OS === 'ios') {
      this.sampleGeneration++;
      useLocalClipboardStore.setState({ currentContent: null });
    }
    await clipboardMonitor.stop();
  }

  isRunning(): boolean {
    return clipboardMonitor.isActive();
  }
}

export const clipboardMonitorTask = new ClipboardMonitorTask();
