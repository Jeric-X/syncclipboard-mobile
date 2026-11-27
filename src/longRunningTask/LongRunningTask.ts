/**
 * LongRunningTask 接口
 * 所有持续后台任务的基础契约。
 *
 * 实现此接口的任务将由 LongRunningTaskManager 统一管理生命周期。
 */

export interface ILongRunningTask {
  /** 任务唯一标识名称 */
  readonly name: string;

  /**
   * 启动任务（幂等）。
   * 若任务已在运行，应直接返回而不抛出异常。
   */
  start(): Promise<void>;

  /**
   * 停止任务（幂等）。
   * 若任务未在运行，应直接返回而不抛出异常。
   */
  stop(): Promise<void>;

  /** 返回任务当前是否正在运行 */
  isRunning(): boolean;

  /**
   * 配置变更时的处理回调。
   * 由任务自身决定是否响应配置变更。
   */
  onConfigChanged(): Promise<void>;

  /**
   * App 切换到后台时的回调。
   * 由任务自身决定是否响应。
   */
  onBackground(): Promise<void>;

  /**
   * App 从后台切换回前台时的回调。
   * 由任务自身决定是否响应。
   */
  onForeground(): Promise<void>;
}

/**
 * AbstractLongRunningTask
 * LongRunningTask 的抽象基类，提供 onConfigChanged 的默认空实现。
 * 子类按需覆盖 onConfigChanged 以响应配置变更。
 */
export abstract class LongRunningTask implements ILongRunningTask {
  abstract readonly name: string;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract isRunning(): boolean;

  onConfigChanged(): Promise<void> {
    return Promise.resolve();
  }

  onBackground(): Promise<void> {
    return Promise.resolve();
  }

  onForeground(): Promise<void> {
    return Promise.resolve();
  }
}
