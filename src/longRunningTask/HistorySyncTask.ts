/**
 * HistorySyncTask
 * 持续任务：管理历史记录同步服务的生命周期。
 *
 * 职责：
 * - 在任务启动时根据当前配置和活跃服务器初始化 HistorySyncService
 * - 通过 onConfigChanged 响应配置变更（服务器切换、历史同步开关）
 * - 任务停止或配置要求关闭时销毁 HistorySyncService
 *
 * 生命周期由 LongRunningTaskManager 统一管理。
 */

import { LongRunningTask } from './LongRunningTask';
import { configService } from '../services/ConfigService';
import {
  getHistorySyncService,
  resetHistorySyncService,
} from '../services/history/HistorySyncService';

class HistorySyncTask extends LongRunningTask {
  readonly name = 'historySync';

  private _running = false;

  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;

    await this._applyConfig();
  }

  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;

    resetHistorySyncService();
  }

  isRunning(): boolean {
    return this._running;
  }

  override async onConfigChanged(): Promise<void> {
    await this._applyConfig();
  }

  // ─── 私有实现 ─────────────────────────────────────────────

  private async _applyConfig(): Promise<void> {
    try {
      const [activeServer, config] = await Promise.all([
        configService.getActiveServer(),
        configService.getConfig(),
      ]);

      if (activeServer && config?.enableHistorySync) {
        await getHistorySyncService().ensureInitialized(activeServer);
      } else {
        resetHistorySyncService();
      }
    } catch (e) {
      console.error('[HistorySyncTask] Failed to apply config:', e);
    }
  }
}

export const historySyncTask = new HistorySyncTask();
