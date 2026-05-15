/**
 * BackgroundRuntimeState
 * 运行时（非持久化）后台任务状态，与 Zustand settingsStore 解耦。
 *
 * 将 isTempDisabledBackgroundTasks 从 settingsStore 中剥离到此独立模块，
 * 使 BackgroundServiceManager 不再反向依赖 UI 状态层（Zustand store）。
 *
 * settingsStore 在模块加载时订阅此单例，将变化镜像到 isTempDisabledBackgroundTasks，
 * 以驱动 UI 响应；BackgroundServiceManager 直接写入并订阅此模块，无需感知 store。
 */

type Listener = () => void;

class BackgroundRuntimeStateClass {
  private _isTempDisabled = false;
  private _listeners = new Set<Listener>();

  /** 当前是否被临时禁用 */
  isTempDisabled(): boolean {
    return this._isTempDisabled;
  }

  /**
   * 设置临时禁用状态，并通知所有订阅者。
   * 由 BackgroundServiceManager 中 ForegroundService.addTempStopListener 直接调用；
   * settingsStore 订阅此通知并将变化镜像到 isTempDisabledBackgroundTasks UI 状态。
   */
  setTempDisabled(value: boolean): void {
    if (this._isTempDisabled === value) return;
    this._isTempDisabled = value;
    this._notify();
  }

  /**
   * 订阅状态变化，返回取消订阅函数。
   * BackgroundServiceManager 通过此接口感知临时禁用状态变化，无需依赖 store。
   */
  subscribe(listener: Listener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notify(): void {
    this._listeners.forEach((l) => {
      try {
        l();
      } catch (e) {
        console.error('[BackgroundRuntimeState] Listener error:', e);
      }
    });
  }
}

export const backgroundRuntimeState = new BackgroundRuntimeStateClass();
