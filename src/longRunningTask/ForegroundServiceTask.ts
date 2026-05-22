/**
 * ForegroundServiceTask
 * 持续任务：管理 Android 前台常驻通知服务。
 *
 * 职责：
 * - 根据后台任务总开关（enableBackgroundTasks + enableBackgroundDownload/Upload +
 *   enableForegroundNotification + tempDisabled）决定是否运行前台服务
 * - 监听通知栏"停止"／"临时停止"操作并写回配置或运行时状态
 * - 通过 onConfigChanged 响应配置变更（由 LongRunningTaskManager 统一分发）
 * - 自行订阅 backgroundRuntimeState，运行时状态变更时动态响应
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
  /** ForegroundService 当前是否正在运行 */
  private _serviceActive = false;

  private _runtimeUnsub: (() => void) | null = null;
  private _stopSub: { remove(): void } | null = null;
  private _tempStopSub: { remove(): void } | null = null;

  async start(): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (this._running) return;
    this._running = true;

    // 立即应用当前配置
    await this._refresh();

    // 订阅运行时状态变更
    this._runtimeUnsub = backgroundRuntimeState.subscribe(() => {
      this._refresh().catch((e) => {
        console.error('[ForegroundServiceTask] Failed to apply runtime state change:', e);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;

    this._runtimeUnsub?.();
    this._runtimeUnsub = null;

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
    if (this._serviceActive) return;
    this._serviceActive = true;

    try {
      ForegroundService.startService();
      this._attachServiceListeners();
    } catch (e) {
      console.error('[ForegroundServiceTask] Failed to start foreground service:', e);
    }

    console.log('[ForegroundServiceTask] Foreground service started');
  }

  /** 停止前台服务 */
  private async _stopService(): Promise<void> {
    if (!this._serviceActive) return;
    this._serviceActive = false;

    this._detachServiceListeners();

    try {
      ForegroundService.stopService();
    } catch {}
  }

  /** 绑定通知栏操作监听 */
  private _attachServiceListeners(): void {
    this._stopSub = ForegroundService.addStopListener(() => {
      configService.updateConfig({ enableBackgroundTasks: false }).catch((e) => {
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
