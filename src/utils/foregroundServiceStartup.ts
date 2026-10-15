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

    const release = await this.deps.acquireOverlay();
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
