/** 创建启动计时器；注入单调时钟，便于验证不同系统运行时长下的行为。 */
export function createStartupClock(now: () => number): () => number {
  const startedAtMs = now();
  return () => now() - startedAtMs;
}

/** 本次 JS 运行时的启动耗时，前后台切换及同一运行时内的服务重启不重置。 */
export const getStartupElapsedMs = createStartupClock(() => performance.now());
