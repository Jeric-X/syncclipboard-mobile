/** 进程级原生会话与 JS 任务之间的可测试协议。 */
export interface HeadlessServiceRuntimeSessionDependencies {
  subscribeStopped: (listener: (sessionId: string) => void) => () => void;
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
  let releaseOverlay: (() => Promise<void>) | undefined;
  try {
    if (!deps.isActive(sessionId)) return;
    releaseOverlay = deps.acquireKeepAliveOverlay?.();
    await deps.initialize();
    if (!deps.isActive(sessionId)) return;
    deps.markReady(sessionId);
    await stopped;
  } finally {
    unsubscribe();
    try {
      await deps.finishSession(sessionId);
    } finally {
      try {
        await releaseOverlay?.();
      } finally {
        await deps.shutdownIfIdle();
      }
    }
  }
}
