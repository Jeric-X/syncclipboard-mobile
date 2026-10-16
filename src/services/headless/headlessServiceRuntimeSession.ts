/** 进程级原生会话与 JS 任务之间的可测试协议。 */
export interface HeadlessServiceRuntimeSessionDependencies {
  subscribeStopped: (listener: (sessionId: string) => void) => () => void;
  subscribeControl?: (listener: (reason: string) => void) => () => void;
  getPendingControl?: () => string | null;
  stopFromControl?: (reason: string) => Promise<void>;
  isActive: (sessionId: string) => boolean;
  initialize: () => Promise<void>;
  acquireKeepAliveOverlay?: () => () => Promise<void>;
  markReady: (sessionId: string) => void;
  finishSession: (sessionId: string) => Promise<void>;
  shutdownIfIdle: () => Promise<void>;
}

/** 保持任务有效直到原生会话结束；订阅必须先于异步初始化，避免遗漏停止事件。 */
export async function runHeadlessServiceRuntimeSession(
  sessionId: string,
  deps: HeadlessServiceRuntimeSessionDependencies
): Promise<void> {
  let finish!: () => void;
  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const unsubscribe = deps.subscribeStopped((id) => {
    if (id === sessionId) finish();
  });
  let controlledStop: Promise<void> | undefined;
  const onControl = (reason: string): void => {
    if (!deps.isActive(sessionId) || controlledStop) return;
    controlledStop = deps.stopFromControl?.(reason);
    // 立即传递取消信号；初始化结束后再等待完整清理，避免串行任务队列死锁。
    controlledStop?.then(finish, finish);
  };
  const unsubscribeControl = deps.subscribeControl?.(onControl);
  let releaseOverlay: (() => Promise<void>) | undefined;
  try {
    if (!deps.isActive(sessionId)) return;
    const pendingControl = deps.getPendingControl?.();
    if (pendingControl) onControl(pendingControl);
    if (!controlledStop) {
      releaseOverlay = deps.acquireKeepAliveOverlay?.();
      try {
        await deps.initialize();
      } catch (error) {
        // 用户停止会取消 UI 的就绪等待，这是正常退出，不是初始化故障。
        if (!controlledStop) throw error;
      }
    }
    if (controlledStop) {
      await controlledStop;
      return;
    }
    if (!deps.isActive(sessionId)) return;
    deps.markReady(sessionId);
    await stopped;
    await controlledStop;
  } finally {
    unsubscribe();
    unsubscribeControl?.();
    try {
      try {
        await controlledStop;
      } finally {
        await deps.finishSession(sessionId);
      }
    } finally {
      try {
        await releaseOverlay?.();
      } finally {
        await deps.shutdownIfIdle();
      }
    }
  }
}
