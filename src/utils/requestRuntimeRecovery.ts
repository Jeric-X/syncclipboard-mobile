/** 恢复 Activity 的运行时请求，独立于进程是否发生 AppState 切换。 */
export function requestRuntimeRecovery(
  requestRuntime: (foregroundEntry?: boolean) => Promise<void>
): Promise<void> {
  return requestRuntime(true);
}
