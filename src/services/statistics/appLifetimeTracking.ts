interface AppLifetimeTrackingDeps {
  startedAt: string;
  now: () => string;
  loadDebugMode: () => Promise<boolean>;
  subscribeDebugMode: (callback: (enabled: boolean) => void) => unknown;
  recordAppStart: (startedAt: string) => Promise<void>;
  updateHeartbeat: () => Promise<void>;
  stopRecording: () => Promise<void>;
  setTimer: (callback: () => void, intervalMs: number) => string;
  clearTimer: (tag: string) => void;
  subscribeAppState: (callback: () => void) => unknown;
  onError: (error: unknown) => void;
}

/** 仅调试模式下统计；前后台共用一段，关闭后重新开启从开启时间另起一段。 */
export function createAppLifetimeTracking(deps: AppLifetimeTrackingDeps): () => void {
  let installed = false;
  let configured = false;
  let enabled = false;
  let startedAt = deps.startedAt;
  let timer: string | null = null;
  let generation = 0;
  let pendingGeneration: number | null = null;
  let queue = Promise.resolve();
  const enqueue = (operation: () => Promise<void>): void => {
    queue = queue.then(operation).catch(deps.onError);
  };
  const heartbeat = (): void => {
    if (!enabled || pendingGeneration === generation) return;
    const currentGeneration = generation;
    const currentStart = startedAt;
    pendingGeneration = currentGeneration;
    enqueue(async () => {
      try {
        if (!enabled || currentGeneration !== generation) return;
        // 启动幂等，存储失败时下次心跳继续尝试。
        await deps.recordAppStart(currentStart);
        if (!enabled || currentGeneration !== generation) return;
        await deps.updateHeartbeat();
      } finally {
        if (pendingGeneration === currentGeneration) pendingGeneration = null;
      }
    });
  };
  const configure = (debugMode: boolean, initial = false): void => {
    configured = true;
    if (enabled === debugMode) return;
    enabled = debugMode;
    generation++;
    if (!enabled) {
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
      // 排在已发出的写入后，防止快速关开时沿用之前的记录。
      enqueue(deps.stopRecording);
      return;
    }
    startedAt = initial ? deps.startedAt : deps.now();
    heartbeat();
    timer = deps.setTimer(heartbeat, 5_000);
  };
  const loadConfig = (): void => {
    deps
      .loadDebugMode()
      .then((debugMode) => {
        // 配置通知比初始读取更新，不能被迟到的读取结果覆盖。
        if (!configured) configure(debugMode, true);
      })
      .catch(deps.onError);
  };
  return () => {
    if (installed) return;
    installed = true;
    deps.subscribeDebugMode((debugMode) => configure(debugMode));
    deps.subscribeAppState(() => {
      if (!configured) loadConfig();
      else heartbeat();
    });
    loadConfig();
  };
}
