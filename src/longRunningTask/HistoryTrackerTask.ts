/**
 * HistoryTrackerTask
 * 持续任务：管理本地历史记录追踪服务的生命周期。
 *
 * 职责：
 * - 启动/停止 HistoryTracker（始终运行，无需服务器配置）
 * - onConfigChanged 使用默认空实现（HistoryTracker 无配置依赖）
 *
 * 注意：注册为 keepAlive = true，后台自动停止逻辑不影响此任务。
 * 生命周期由 LongRunningTaskManager 统一管理。
 */

import { LongRunningTask } from './LongRunningTask';
import { getHistoryTracker } from '../services/history/HistoryTracker';

class HistoryTrackerTask extends LongRunningTask {
  readonly name = 'historyTracker';

  private _running = false;

  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;
    getHistoryTracker().startTracking();
  }

  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;
    getHistoryTracker().stopTracking();
  }

  isRunning(): boolean {
    return this._running;
  }
}

export const historyTrackerTask = new HistoryTrackerTask();
