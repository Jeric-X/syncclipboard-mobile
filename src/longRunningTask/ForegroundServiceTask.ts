/**
 * ForegroundServiceTask
 * 持续任务：管理 Android 前台常驻通知服务。
 *
 * 职责：
 * - 根据后台任务总开关（enableBackgroundTasks + enableBackgroundDownload/Upload +
 *   enableForegroundNotification + tempDisabled）决定是否运行前台服务
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
import { acquireStartupOverlay } from '../services/overlay/OverlayManager';
import { nativeSleep } from 'native-timer';
import type { AppConfig } from '../types/storage';

export interface ForegroundServiceStartupDependencies {
  isRunning: () => boolean;
  start: () => boolean;
  shouldRun: () => Promise<boolean>;
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  acquireOverlay: () => Promise<(() => Promise<void>) | null>;
}

/** 合并并发请求；失败只借用一次悬浮窗重试，停止请求取消整轮启动。 */
export class ForegroundServiceStartup {
  private pending: Promise<boolean> | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly deps: ForegroundServiceStartupDependencies) {}

  start(): Promise<boolean> {
    if (this.pending) return this.pending;
    const controller = new AbortController();
    this.controller = controller;
    this.pending = this.run(controller.signal).finally(() => {
      this.pending = null;
      this.controller = null;
    });
    return this.pending;
  }

  cancel(): void {
    this.controller?.abort();
  }

  private async run(signal: AbortSignal): Promise<boolean> {
    const allowed = async () => {
      const shouldRun = await this.deps.shouldRun();
      return !signal.aborted && shouldRun;
    };
    const request = () => {
      try {
        // 返回值仅代表请求是否被接受，成功必须由 isRunning 确认。
        this.deps.start();
      } catch {
        // 后台启动被拒绝也进入相同的有限重试流程。
      }
    };
    if (!(await allowed())) return false;
    if (this.deps.isRunning()) return true;
    request();
    if (!this.deps.isRunning()) await this.deps.sleep(1000, signal);
    if (!(await allowed())) return false;
    if (this.deps.isRunning()) return true;

    // 原生创建异常同样表示窗口不可用，仍需确认首次请求是否已经成功。
    const release = await this.deps.acquireOverlay().catch(() => null);
    // 等待窗口期间首次请求可能已成功；窗口不可用不能覆盖真实的服务状态。
    if (!release) return (await allowed()) && this.deps.isRunning();
    try {
      if (!(await allowed())) return false;
      // 从原生创建函数返回后计时，不能把异步创建时间算进这一秒。
      await this.deps.sleep(1000, signal);
      if (!(await allowed())) return false;
      if (this.deps.isRunning()) return true;
      request();
      if (!this.deps.isRunning()) await this.deps.sleep(1000, signal);
      return (await allowed()) && this.deps.isRunning();
    } finally {
      await release();
    }
  }
}

class ForegroundServiceTask extends LongRunningTask {
  readonly name = 'foregroundService';

  /** 任务是否已启动（订阅是否活跃） */
  private _running = false;
  private readonly _startup = new ForegroundServiceStartup({
    isRunning: ForegroundService.isRunning,
    start: ForegroundService.startService,
    shouldRun: () => this._shouldRunForegroundService(),
    sleep: nativeSleep,
    acquireOverlay: acquireStartupOverlay,
  });

  async start(): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (this._running) return;
    this._running = true;

    // 立即应用当前配置
    await this._refresh();
  }

  async stop(): Promise<void> {
    this._running = false;
    this._startup.cancel();

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
    return this._running && this._configAllowsService(config);
  }

  private _configAllowsService(config: AppConfig | null): boolean {
    return (
      !backgroundRuntimeState.isTempDisabled() &&
      !ForegroundService.getStopReason() &&
      !!config?.enableBackgroundTasks &&
      !!(config?.enableBackgroundDownload || config?.enableBackgroundUpload) &&
      !!config?.enableForegroundNotification
    );
  }

  /** 根据当前配置决定启动或停止服务 */
  private async _refresh(): Promise<void> {
    const config = await configService.getConfig();
    ForegroundService.setStickyEnabled(config.enableForegroundServiceSticky !== false);
    if (this._running && this._configAllowsService(config)) {
      try {
        await this._startService();
      } catch (error) {
        // 失败不能留下“任务已运行”的标记，否则下一次独立入口无法再次确保服务。
        this._running = false;
        throw error;
      }
    } else {
      await this._stopService();
    }
  }

  /** 启动前台服务 */
  private async _startService(): Promise<void> {
    // 配置通知不能等任务管理器串行队列，否则关闭再开启可能漏掉取消信号。
    const unsubscribeConfig = configService.subscribe((config) => {
      if (!this._configAllowsService(config)) this._startup.cancel();
    });
    const unsubscribeState = backgroundRuntimeState.subscribe(() => {
      if (backgroundRuntimeState.isTempDisabled()) this._startup.cancel();
    });
    const sessionId = ForegroundService.getSessionId();
    const stopped = ForegroundService.addSessionStoppedListener((event) => {
      if (event.sessionId === sessionId) this._startup.cancel();
    });
    try {
      if (await this._startup.start()) {
        // Headless 是任务初始化的唯一入口；这里不再反向创建会话。
        if ((await this._shouldRunForegroundService()) && !ForegroundService.isRunning()) {
          throw new Error('Foreground service stopped during startup confirmation');
        }
      } else if (await this._shouldRunForegroundService()) {
        // 观察超时不代表原生请求已失效，退出前取消仍可能迟到的启动。
        throw new Error('Foreground service did not enter the foreground after bounded retries');
      }
    } catch (error) {
      // 配置读取或原生等待拒绝也必须取消仍可能迟到的启动请求。
      await this._stopService();
      throw error;
    } finally {
      unsubscribeConfig();
      unsubscribeState();
      stopped?.remove();
    }
  }

  /** 停止服务，包括由 Android 冷启动而非本 JS 实例创建的服务。 */
  private async _stopService(): Promise<void> {
    this._startup.cancel();
    // 原生请求可能来自重载前的 JS；由原生取消前台服务的启动代号。
    ForegroundService.stopService();
  }
}

export const foregroundServiceTask = new ForegroundServiceTask();
