/**
 * LongRunningTask 接口
 * 所有持续后台任务的基础契约。
 *
 * 实现此接口的任务将由 LongRunningTaskManager 统一管理生命周期。
 */

export interface LongRunningTask {
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
}
