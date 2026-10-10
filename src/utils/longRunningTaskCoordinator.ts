import type { ILongRunningTask } from '../longRunningTask/LongRunningTask';
import { measureStartup } from './startupTiming';

/** UI 与 Headless 共用的任务策略；未知 AppState 按后台处理。 */
export interface TaskRuntimePolicy {
  foreground: boolean;
  backgroundEnabled: boolean;
}

/** 串行化生命周期操作，防止多个入口或配置通知交错启动、停止同一任务。 */
export class LongRunningTaskCoordinator {
  private tasks = new Map<string, { task: ILongRunningTask; keepAlive: boolean }>();
  private queue: Promise<void> = Promise.resolve();
  private enabled = false;

  constructor(
    private readonly getPolicy: () => Promise<TaskRuntimePolicy>,
    private readonly reportError: (name: string, error: unknown) => void
  ) {}

  register(task: ILongRunningTask, keepAlive = false): void {
    this.tasks.set(task.name, { task, keepAlive });
  }

  unregister(name: string): void {
    this.tasks.delete(name);
  }

  isRunning(name: string): boolean {
    return this.tasks.get(name)?.task.isRunning() ?? false;
  }

  startAll(): Promise<void> {
    return this.enqueue(async () => {
      this.enabled = true;
      await this.reconcile();
    });
  }

  stopAll(): Promise<void> {
    return this.enqueue(async () => {
      this.enabled = false;
      for (const { task } of [...this.tasks.values()].reverse()) {
        await this.safely(task, () => task.stop());
      }
    });
  }

  refresh(configChanged = false): Promise<void> {
    return this.enqueue(async () => {
      if (!this.enabled) return;
      if (configChanged) {
        for (const { task } of this.tasks.values()) {
          if (task.isRunning()) await this.safely(task, () => task.onConfigChanged());
        }
      }
      await this.reconcile();
    });
  }

  start(name: string): Promise<void> {
    return this.enqueue(() => this.getTask(name).start());
  }

  stop(name: string): Promise<void> {
    return this.enqueue(() => this.getTask(name).stop());
  }

  private getTask(name: string): ILongRunningTask {
    const entry = this.tasks.get(name);
    if (!entry) throw new Error(`Task "${name}" is not registered.`);
    return entry.task;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  private async safely(task: ILongRunningTask, operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.reportError(task.name, error);
    }
  }

  private async reconcile(): Promise<void> {
    const policy = await this.getPolicy();
    const active: ILongRunningTask[] = [];
    // 注册顺序保证网络选择和同步回调先于剪贴板监听初始化。
    for (const { task, keepAlive } of this.tasks.values()) {
      if (keepAlive || policy.foreground || policy.backgroundEnabled) {
        if (!task.isRunning()) {
          await this.safely(task, () =>
            measureStartup(`task.${task.name}.start`, () => task.start())
          );
        }
        active.push(task);
      } else {
        await this.safely(task, () => task.stop());
      }
    }
    // 无 Activity 的冷启动不会收到一次 background 事件，必须主动应用状态。
    for (const task of active) {
      await this.safely(task, () =>
        measureStartup(`task.${task.name}.initialPolicy`, () =>
          policy.foreground ? task.onForeground() : task.onBackground()
        )
      );
    }
  }
}
