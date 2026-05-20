/**
 * LongRunningTaskManager
 * 统一管理所有持续后台任务的生命周期。
 *
 * 职责：
 * - 注册/注销 LongRunningTask 实例
 * - 统一启动/停止所有已注册任务
 * - 按名称单独控制单个任务
 */

import type { LongRunningTask } from './LongRunningTask';
import { smsForwardingTask } from './SmsForwardingTask';
import { foregroundServiceTask } from './ForegroundServiceTask';

class LongRunningTaskManager {
  private static instance: LongRunningTaskManager | null = null;

  private readonly tasks = new Map<string, LongRunningTask>();

  private constructor() {}

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
   */
  register(task: LongRunningTask): void {
    this.tasks.set(task.name, task);
  }

  /** 注销一个持续任务（不会自动停止任务）。 */
  unregister(name: string): void {
    this.tasks.delete(name);
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

  private _getOrThrow(name: string): LongRunningTask {
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
longRunningTaskManager.register(smsForwardingTask);
longRunningTaskManager.register(foregroundServiceTask);
