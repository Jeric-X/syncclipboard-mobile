interface Initialization {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  started: boolean;
}

/** UI 仅等待会话初始化；初始化操作只由对应的 Headless 入口执行。 */
export class HeadlessRuntimeInitialization {
  private sessions = new Map<string, Initialization>();

  private get(sessionId: string): Initialization {
    let entry = this.sessions.get(sessionId);
    if (!entry) {
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      // 无 UI 等待者时，初始化异常仍由 Headless 调用方处理。
      void promise.catch(() => {});
      entry = { promise, resolve, reject, started: false };
      this.sessions.set(sessionId, entry);
    }
    return entry;
  }

  wait(sessionId: string): Promise<void> {
    return this.get(sessionId).promise;
  }

  initialize(sessionId: string, initialize: () => Promise<void>): Promise<void> {
    const entry = this.get(sessionId);
    if (!entry.started) {
      entry.started = true;
      void Promise.resolve()
        .then(() => {
          if (this.sessions.get(sessionId) !== entry) {
            throw new Error('Headless session ended before initialization');
          }
          return initialize();
        })
        .then(entry.resolve, entry.reject);
    }
    return entry.promise;
  }

  end(sessionId: string): void {
    this.sessions.get(sessionId)?.reject(new Error('Headless session ended before initialization'));
    this.sessions.delete(sessionId);
  }
}

export const headlessRuntimeInitialization = new HeadlessRuntimeInitialization();
