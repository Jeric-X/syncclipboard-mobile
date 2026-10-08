/** 设置界面更新临时暂停状态时使用的原生与内存依赖。 */
export interface BackgroundTaskPauseDependencies {
  getStopReason: () => string | null;
  clearStopReason: () => void;
  setTempDisabled: (disabled: boolean) => void;
}

/** 更新用户显式选择的临时暂停状态。 */
export function updateBackgroundTaskPause(
  disabled: boolean,
  deps: BackgroundTaskPauseDependencies
): void {
  // 先解除原生暂停，再让订阅者重新评估前台服务；永久停止由配置处理。
  if (!disabled && deps.getStopReason() === 'temporary') {
    deps.clearStopReason();
  }
  deps.setTempDisabled(disabled);
}
