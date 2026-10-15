/** 共享悬浮窗的配置；保活与剪贴板读取分别持有使用权。 */
export interface OverlayConfig {
  enableClipboardOverlay: boolean;
  enableOverlayKeepAlive: boolean;
  debugMode: boolean;
  debugOverlayVisible: boolean;
}

export interface OverlayLifecycleDependencies {
  hasPermission: () => boolean;
  isShowing: () => boolean;
  show: () => Promise<boolean>;
  hide: () => Promise<boolean>;
  setDebugMode: (enabled: boolean) => void;
  setMaxRetries: (retries: number) => void;
  scheduleIdle: (callback: () => void) => void;
  cancelIdle: () => void;
  onError: (error: unknown) => void;
}

/** 串行创建/移除窗口，避免异步关闭误伤另一项功能或正在进行的读取。 */
export class OverlayLifecycle {
  private config: OverlayConfig | null = null;
  private foreground = false;
  private sessions = new Set<symbol>();
  private startups = new Set<symbol>();
  private clipboardIdle = false;
  private reads = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: OverlayLifecycleDependencies) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  private async syncWindow(): Promise<void> {
    this.deps.setDebugMode(!!this.config?.debugMode && !!this.config?.debugOverlayVisible);
    this.deps.setMaxRetries(this.config?.debugMode ? 20 : 5);
    const needed =
      this.startups.size > 0 ||
      this.reads > 0 ||
      this.clipboardIdle ||
      (!!this.config?.enableOverlayKeepAlive && this.sessions.size > 0);
    if (needed && this.deps.hasPermission()) {
      if (!this.deps.isShowing()) await this.deps.show();
    } else if (this.deps.isShowing()) {
      await this.deps.hide();
    }
  }

  private reconcile(): Promise<void> {
    return this.enqueue(() => this.syncWindow()).catch(this.deps.onError);
  }

  updateConfig(config: OverlayConfig): Promise<void> {
    this.config = config;
    if (!config.enableClipboardOverlay) this.clearClipboardIdle();
    return this.reconcile();
  }

  setForeground(foreground: boolean): Promise<void> {
    this.foreground = foreground;
    if (foreground) this.clearClipboardIdle();
    return this.reconcile();
  }

  /** 每个 Headless 会话独立释放，旧会话结束不会关闭新会话的窗口。 */
  acquireKeepAlive(): () => Promise<void> {
    const token = Symbol('headless-overlay');
    this.sessions.add(token);
    void this.reconcile();
    return () => {
      this.sessions.delete(token);
      return this.reconcile();
    };
  }

  /** 临时借用窗口辅助前台服务启动，必须等待原生创建完成再返回。 */
  acquireStartup(): Promise<(() => Promise<void>) | null> {
    return this.enqueue(async () => {
      if (!this.deps.hasPermission()) return null;
      const token = Symbol('foreground-startup');
      this.startups.add(token);
      try {
        await this.syncWindow();
        if (!this.deps.hasPermission() || !this.deps.isShowing()) {
          this.startups.delete(token);
          await this.syncWindow();
          return null;
        }
      } catch (error) {
        this.startups.delete(token);
        await this.syncWindow();
        throw error;
      }
      return () => {
        this.startups.delete(token);
        return this.reconcile();
      };
    });
  }

  private clearClipboardIdle(): void {
    this.deps.cancelIdle();
    this.clipboardIdle = false;
  }

  /** 仅释放剪贴板空闲占用，不影响保活需求或尚未完成的读取。 */
  dismissClipboard(): Promise<void> {
    this.clearClipboardIdle();
    return this.reconcile();
  }

  /** 成功时返回读取结束后的释放函数；保活开关本身不授予剪贴板访问。 */
  acquireClipboard(): Promise<(() => Promise<void>) | null> {
    return this.enqueue(async () => {
      if (this.foreground || !this.config?.enableClipboardOverlay || !this.deps.hasPermission()) {
        return null;
      }
      this.deps.setDebugMode(!!this.config.debugMode && !!this.config.debugOverlayVisible);
      this.deps.setMaxRetries(this.config.debugMode ? 20 : 5);
      if (!this.deps.isShowing() && !(await this.deps.show())) return null;
      // 创建窗口期间可能回到前台、关闭设置或撤销权限。
      if (this.foreground || !this.config?.enableClipboardOverlay || !this.deps.hasPermission()) {
        await this.syncWindow();
        return null;
      }
      this.reads += 1;
      this.clipboardIdle = true;
      this.deps.cancelIdle();
      let released = false;
      return () => {
        if (released) return Promise.resolve();
        released = true;
        this.reads -= 1;
        if (this.reads === 0 && this.clipboardIdle) {
          this.deps.scheduleIdle(() => {
            void this.dismissClipboard();
          });
        }
        return this.reconcile();
      };
    });
  }
}
