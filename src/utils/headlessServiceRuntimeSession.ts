/** 原生服务会话与 JS 任务之间的可测试协议。 */
export interface HeadlessServiceRuntimeSessionDependencies {
  subscribeStopped: (listener: (sessionId: string) => void) => () => void;
  isActive: (sessionId: string) => boolean;
  initialize: () => Promise<void>;
  markReady: (sessionId: string) => void;
  shutdownIfIdle: () => Promise<void>;
}

/** 保持任务有效直到原生服务停止；订阅必须先于异步初始化，避免遗漏停止事件。 */
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
  try {
    if (!deps.isActive(sessionId)) return;
    await deps.initialize();
    if (!deps.isActive(sessionId)) return;
    deps.markReady(sessionId);
    await stopped;
  } finally {
    unsubscribe();
    await deps.shutdownIfIdle();
  }
}
