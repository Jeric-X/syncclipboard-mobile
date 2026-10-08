/**
 * ForegroundServiceTask
 * 持续任务：管理 Android 前台常驻通知服务。
 *
 * 职责：
 * - 根据后台任务总开关（enableBackgroundTasks + enableBackgroundDownload/Upload +
 *   enableForegroundNotification + tempDisabled）决定是否运行前台服务
 * - 监听通知栏"停止"／"临时停止"操作并写回配置或运行时状态
 * - 通过 onConfigChanged 响应配置变更（由 LongRunningTaskManager 统一分发）
 * - 运行时状态变化由任务管理器统一串行分发
 *
 * 注意：仅在 Android 上生效，iOS 直接 no-op。
 * 生命周期由 LongRunningTaskManager 统一管理。
 */

import { Platform } from 'react-native';
import * as ForegroundService from 'foreground-service';
import { LongRunningTask } from './LongRunningTask';
import { configService } from '../services/ConfigService';
import { backgroundRuntimeState } from '../services/BackgroundRuntimeState';

class ForegroundServiceTask extends LongRunningTask {
  readonly name = 'foregroundService';

  /** 任务是否已启动（订阅是否活跃） */
  private _running = false;
  private _stopSub: { remove(): void } | null = null;
  private _tempStopSub: { remove(): void } | null = null;

  async start(): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (this._running) return;
    this._running = true;

    // 清除可能残留的复活通知（用户未通过复活通知而是直接打开 APP 时，通知不会自动消失）
    ForegroundService.cancelRestartNotification();

    // 立即应用当前配置
    await this._refresh();
  }

  async stop(): Promise<void> {
    this._running = false;

    await this._stopService();
  }

  isRunning(): boolean {
    return this._running;
  }

  override async onConfigChanged(): Promise<void> {
    await this._refresh();
  }

  // ─── 私有实现 ─────────────────────────────────────────────

  private async _shouldRunForegroundService(): Promise<boolean> {
    const config = await configService.getConfig();
    const tempDisabled = backgroundRuntimeState.isTempDisabled();
    return (
      !tempDisabled &&
      !ForegroundService.getStopReason() &&
      !!config?.enableBackgroundTasks &&
      !!(config?.enableBackgroundDownload || config?.enableBackgroundUpload) &&
      !!config?.enableForegroundNotification
    );
  }

  /** 根据当前配置决定启动或停止服务 */
  private async _refresh(): Promise<void> {
    if (await this._shouldRunForegroundService()) {
      await this._startService();
    } else {
      await this._stopService();
    }
  }

  /** 启动前台服务 */
  private async _startService(): Promise<void> {
    this._attachServiceListeners();
    // 原生服务负责去重，也能在 JS reload 后重新绑定 Headless 会话。
    if (!ForegroundService.startService()) {
      throw new Error('Foreground service could not be started');
    }
  }

  /** 停止服务，包括由 Android 冷启动而非本 JS 实例创建的服务。 */
  private async _stopService(): Promise<void> {
    this._detachServiceListeners();
    ForegroundService.stopService();
  }

  /** 绑定通知栏操作监听 */
  private _attachServiceListeners(): void {
    if (this._stopSub || this._tempStopSub) return;
    this._stopSub = ForegroundService.addStopListener(() => {
      configService
        .updateConfig({ enableBackgroundTasks: false })
        .then(() => ForegroundService.clearStopReason())
        .catch((e) => {
          console.error('[ForegroundServiceTask] Failed to disable background tasks:', e);
        });
    });
    this._tempStopSub = ForegroundService.addTempStopListener(() => {
      backgroundRuntimeState.setTempDisabled(true);
    });
  }

  /** 移除通知栏操作监听 */
  private _detachServiceListeners(): void {
    this._stopSub?.remove();
    this._tempStopSub?.remove();
    this._stopSub = null;
    this._tempStopSub = null;
  }
}

export const foregroundServiceTask = new ForegroundServiceTask();
