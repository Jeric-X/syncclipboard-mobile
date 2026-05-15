/**
 * BackgroundRuntimeState
 * 运行时（非持久化）后台任务状态，与 Zustand settingsStore 解耦。
 *
 * 将 isTempDisabledBackgroundTasks 从 settingsStore 中剥离到此独立模块，
 * 使 BackgroundServiceManager 不再反向依赖 UI 状态层（Zustand store）。
 *
 * settingsStore 仍持有该布尔值以驱动 UI 显示，但写入路径统一走此模块，
 * 再由 settingsStore 镜像同步。
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
   * 由 ForegroundService 的 tempStop 事件触发（经由注入回调中转）。
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
