/**
 * SmsForwardingTask
 * 持续任务：管理短信验证码自动转发（静态接收器启停）。
 *
 * 职责：
 * - 根据 enableSmsForwarding 配置启用/禁用 Android 静态短信接收器
 * - 通过 onConfigChanged 响应配置变更（由 LongRunningTaskManager 统一分发）
 *
 * 注意：仅在 Android 上生效，iOS 直接 no-op。
 * 生命周期由 LongRunningTaskManager 统一管理。
 */

import { Platform } from 'react-native';
import { LongRunningTask } from './LongRunningTask';
import { configService } from '../services/ConfigService';

class SmsForwardingTask extends LongRunningTask {
  readonly name = 'smsForwarding';

  private _running = false;

  async start(): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (this._running) return;
    this._running = true;

    // 立即应用当前配置
    await this._applyConfig();
  }

  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;

    try {
      const { setStaticReceiverEnabled } = require('sms-forwarder');
      setStaticReceiverEnabled(false);
    } catch (e) {
      console.error('[SmsForwardingTask] Failed to disable SMS receiver on stop:', e);
    }
  }

  isRunning(): boolean {
    return this._running;
  }

  override onConfigChanged(): Promise<void> {
    return this._applyConfig();
  }

  // ─── 私有实现 ─────────────────────────────────────────────

  private async _applyConfig(): Promise<void> {
    try {
      const config = await configService.getConfig();
      const { setStaticReceiverEnabled } = require('sms-forwarder');
      setStaticReceiverEnabled(!!config?.enableSmsForwarding);
    } catch (e) {
      console.error('[SmsForwardingTask] Failed to toggle SMS receiver:', e);
    }
  }
}

export const smsForwardingTask = new SmsForwardingTask();
