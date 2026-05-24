/**
 * LongRunningTaskManager
 * 统一管理所有持续后台任务的生命周期。
 *
 * 职责：
 * - 注册/注销 LongRunningTask 实例
 * - 统一启动/停止所有已注册任务
 * - 按名称单独控制单个任务
 * - 订阅 configService 并分发 onConfigChanged
 * - 当 app 进入后台，或处于后台时配置/运行时状态要求停止，自动停止所有任务
 */

import type { ILongRunningTask } from './LongRunningTask';
import { smsForwardingTask } from './SmsForwardingTask';
import { foregroundServiceTask } from './ForegroundServiceTask';
import { historySyncTask } from './HistorySyncTask';
import { clipboardMonitorTask } from './ClipboardMonitorTask';
import { historyTrackerTask } from './HistoryTrackerTask';
import { clipboardSyncTask } from './ClipboardSyncTask';
import { remoteClipboardMonitorTask } from './RemoteClipboardMonitorTask';
import { heartbeatTask } from './HeartbeatTask';
import { configService } from '../services/ConfigService';
import { backgroundRuntimeState } from '../services/BackgroundRuntimeState';
import { AppState, type AppStateStatus } from 'react-native';

class LongRunningTaskManager {
  private static instance: LongRunningTaskManager | null = null;

  private readonly tasks = new Map<string, ILongRunningTask>();
  private readonly _keepAliveTasks = new Set<string>();
  private _appState: AppStateStatus = AppState.currentState;

  private constructor() {
    configService.subscribe(() => {
      this._notifyConfigChanged();
      this._syncBackgroundTaskState();
    });

    backgroundRuntimeState.subscribe(() => {
      this._syncBackgroundTaskState();
    });

    AppState.addEventListener('change', (nextState) => {
      const wasBackground = this._appState === 'background';
      this._appState = nextState;
      if (!wasBackground && nextState === 'background') {
        this._notifyBackground();
        this._syncBackgroundTaskState();
      } else if (wasBackground && nextState !== 'background') {
        this._notifyForeground();
        this._startNonKeepAlive();
      }
    });
  }

  static getInstance(): LongRunningTaskManager {
    if (!LongRunningTaskManager.instance) {
      LongRunningTaskManager.instance = new LongRunningTaskManager();
    }
    return LongRunningTaskManager.instance;
  }

  // ─── 注册 ────────────────────────────────────────────────

  /**
   * 注册一个持续任务。
   * 若已存在同名任务则覆盖。
   * @param keepAlive 若为 true，此任务不受后台任务总开关控制，使其保持运行。
   */
  register(task: ILongRunningTask, keepAlive = false): void {
    this.tasks.set(task.name, task);
    if (keepAlive) {
      this._keepAliveTasks.add(task.name);
    } else {
      this._keepAliveTasks.delete(task.name);
    }
  }

  /** 注销一个持续任务（不会自动停止任务）。 */
  unregister(name: string): void {
    this.tasks.delete(name);
    this._keepAliveTasks.delete(name);
  }

  // ─── 批量控制 ────────────────────────────────────────────

  /** 启动所有已注册的任务（并行执行，单个失败不影响其他任务）。 */
  async startAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.tasks.values()).map((task) =>
        task.start().catch((e) => {
          console.error(`[LongRunningTaskManager] Failed to start task "${task.name}":`, e);
        })
      )
    );
  }

  /** 停止所有已注册的任务（并行执行，单个失败不影响其他任务）。 */
  async stopAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.tasks.values()).map((task) =>
        task.stop().catch((e) => {
          console.error(`[LongRunningTaskManager] Failed to stop task "${task.name}":`, e);
        })
      )
    );
  }

  // ─── 单任务控制 ──────────────────────────────────────────

  /** 按名称启动单个任务，任务不存在时抛出异常。 */
  async start(name: string): Promise<void> {
    const task = this._getOrThrow(name);
    await task.start();
  }

  /** 按名称停止单个任务，任务不存在时抛出异常。 */
  async stop(name: string): Promise<void> {
    const task = this._getOrThrow(name);
    await task.stop();
  }

  /** 返回指定任务是否正在运行，任务不存在时返回 false。 */
  isRunning(name: string): boolean {
    return this.tasks.get(name)?.isRunning() ?? false;
  }

  // ─── 私有工具 ────────────────────────────────────────────

  private _notifyConfigChanged(): void {
    for (const task of this.tasks.values()) {
      if (task.isRunning()) {
        task.onConfigChanged().catch((e) => {
          console.error(`[LongRunningTaskManager] Task "${task.name}" onConfigChanged failed:`, e);
        });
      }
    }
  }

  private _notifyBackground(): void {
    for (const task of this.tasks.values()) {
      task.onBackground().catch((e) => {
        console.error(`[LongRunningTaskManager] Task "${task.name}" onBackground failed:`, e);
      });
    }
  }

  private _notifyForeground(): void {
    for (const task of this.tasks.values()) {
      task.onForeground().catch((e) => {
        console.error(`[LongRunningTaskManager] Task "${task.name}" onForeground failed:`, e);
      });
    }
  }

  /**
   * 后台时根据当前配置同步任务运行状态：
   * - 若应停止（总开关关闭或临时禁用），停止所有非 keepAlive 任务
   * - 若应运行（总开关开启且未临时禁用），启动所有非 keepAlive 任务
   */
  private _syncBackgroundTaskState(): void {
    if (this._appState !== 'background') return;
    configService
      .getConfig()
      .then((config) => {
        const shouldStop =
          backgroundRuntimeState.isTempDisabled() || !config?.enableBackgroundTasks;
        if (shouldStop) {
          this._stopNonKeepAlive();
        } else {
          this._startNonKeepAlive();
        }
      })
      .catch((e) => {
        console.error(
          '[LongRunningTaskManager] Failed to get config in _syncBackgroundTaskState:',
          e
        );
      });
  }

  /**
   * 启动所有非 keepAlive 任务（已在运行的任务会被幂等地跳过）。
   * 在 app 从后台回到前台时调用，以恢复后台期间被停止的任务。
   */
  private _startNonKeepAlive(): void {
    const targets = Array.from(this.tasks.values()).filter(
      (task) => !this._keepAliveTasks.has(task.name)
    );
    Promise.allSettled(
      targets.map((task) =>
        task.start().catch((e) => {
          console.error(`[LongRunningTaskManager] Failed to start task "${task.name}":`, e);
        })
      )
    ).catch(() => {});
  }

  /** 停止所有非 keepAlive 任务。 */
  private _stopNonKeepAlive(): void {
    const targets = Array.from(this.tasks.values()).filter(
      (task) => !this._keepAliveTasks.has(task.name)
    );
    Promise.allSettled(
      targets.map((task) =>
        task.stop().catch((e) => {
          console.error(`[LongRunningTaskManager] Failed to stop task "${task.name}":`, e);
        })
      )
    ).catch(() => {});
  }

  private _getOrThrow(name: string): ILongRunningTask {
    const task = this.tasks.get(name);
    if (!task) {
      throw new Error(`[LongRunningTaskManager] Task "${name}" is not registered.`);
    }
    return task;
  }
}

export const longRunningTaskManager = LongRunningTaskManager.getInstance();

// ─── 注册所有持续任务 ─────────────────────────────────────────
// 在此统一声明，供后续迁移 BackgroundServiceManager 时逐步扩展。
longRunningTaskManager.register(smsForwardingTask, true);
longRunningTaskManager.register(clipboardMonitorTask, true);
longRunningTaskManager.register(remoteClipboardMonitorTask, true);
longRunningTaskManager.register(historyTrackerTask, true);
longRunningTaskManager.register(foregroundServiceTask);
longRunningTaskManager.register(historySyncTask);
longRunningTaskManager.register(clipboardSyncTask);
longRunningTaskManager.register(heartbeatTask);
