import type { ILongRunningTask } from './LongRunningTask';
import { measureStartup } from '../services/StartupTiming';

/** UI 与 Headless 共用的任务策略；未知 AppState 按后台处理。 */
export interface TaskRuntimePolicy {
  foreground: boolean;
  backgroundEnabled: boolean;
  /** 每次真正退后台递增，使队列可合并过时的前台事件。 */
  foregroundSession?: number;
}

interface RegisteredTask {
  task: ILongRunningTask;
  keepAlive: boolean;
  /** 最近一次成功分发的前后台状态，任务重新启动后需重新通知。 */
  foreground?: boolean;
}

/** 串行化生命周期操作，防止多个入口或配置通知交错启动、停止同一任务。 */
export class LongRunningTaskCoordinator {
  private tasks = new Map<string, RegisteredTask>();
  private queue: Promise<void> = Promise.resolve();
  private enabled = false;
  private foregroundSession?: number;

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
      for (const entry of [...this.tasks.values()].reverse()) {
        entry.foreground = undefined;
        await this.safely(entry.task, () => entry.task.stop());
      }
    });
  }

  refresh(configChanged = false): Promise<void> {
    return this.enqueue(async () => {
      if (!this.enabled) return;
      await this.reconcile(configChanged);
    });
  }

  start(name: string): Promise<void> {
    return this.enqueue(async () =>
      this.getTask(name).task.start((await this.getPolicy()).foreground)
    );
  }

  stop(name: string): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.getTask(name);
      entry.foreground = undefined;
      await entry.task.stop();
    });
  }

  private getTask(name: string): RegisteredTask {
    const entry = this.tasks.get(name);
    if (!entry) throw new Error(`Task "${name}" is not registered.`);
    return entry;
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

  private async reconcile(configChanged = false): Promise<void> {
    const policy = await this.getPolicy();
    if (policy.foregroundSession !== this.foregroundSession) {
      const missedBackground = this.foregroundSession !== undefined && policy.foreground;
      this.foregroundSession = policy.foregroundSession;
      if (missedBackground) {
        // 切出后很快返回时，补发后台回调，让监听器自行结束上一轮监听。
        for (const entry of this.tasks.values()) {
          const { task, keepAlive } = entry;
          if (entry.foreground !== true || !task.isRunning()) continue;
          await this.safely(task, async () => {
            if (keepAlive || policy.backgroundEnabled) {
              await task.onBackground();
              entry.foreground = false;
            } else {
              await task.stop();
              entry.foreground = undefined;
            }
          });
        }
        // 断开连接可能耗时，恢复前重新读取当前状态。
        return this.reconcile(configChanged);
      }
    }
    const pending: RegisteredTask[] = [];
    // 同步服务先更新订阅，监听器随后才能读取最新的后台运行条件。
    for (const entry of this.tasks.values()) {
      const { task, keepAlive } = entry;
      if (!keepAlive && !policy.foreground && !policy.backgroundEnabled) {
        entry.foreground = undefined;
        await this.safely(task, () => task.stop());
        continue;
      }
      await this.safely(task, async () => {
        if (!task.isRunning()) {
          entry.foreground = undefined;
          await measureStartup(`task.${task.name}.start`, () => task.start(policy.foreground));
        } else if (configChanged) {
          await task.onConfigChanged(policy.foreground);
        }
      });
      if (task.isRunning() && entry.foreground !== policy.foreground) pending.push(entry);
    }

    for (const entry of pending) {
      const { task } = entry;
      await this.safely(task, async () => {
        await measureStartup(`task.${task.name}.initialPolicy`, () =>
          policy.foreground ? task.onForeground() : task.onBackground()
        );
        entry.foreground = policy.foreground;
      });
    }
  }
}
