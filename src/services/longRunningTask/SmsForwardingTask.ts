/**
 * SmsForwardingTask
 * 持续任务：管理短信验证码自动转发（静态接收器启停）。
 *
 * 职责：
 * - 根据 enableSmsForwarding 配置启用/禁用 Android 静态短信接收器
 * - 自行订阅 configService，配置变更时动态响应
 *
 * 注意：仅在 Android 上生效，iOS 直接 no-op。
 * 生命周期由 LongRunningTaskManager 统一管理。
 */

import { Platform } from 'react-native';
import type { LongRunningTask } from './LongRunningTask';
import { configService } from '../ConfigService';

class SmsForwardingTask implements LongRunningTask {
  readonly name = 'smsForwarding';

  private _running = false;
  private _configUnsub: (() => void) | null = null;

  async start(): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (this._running) return;
    this._running = true;

    // 立即应用当前配置
    await this._applyConfig();

    // 订阅后续配置变更
    this._configUnsub = configService.subscribe(() => {
      this._applyConfig().catch((e) => {
        console.error('[SmsForwardingTask] Failed to apply config change:', e);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;

    this._configUnsub?.();
    this._configUnsub = null;

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
