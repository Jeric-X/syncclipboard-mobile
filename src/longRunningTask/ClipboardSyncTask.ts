/**
 * ClipboardSyncTask
 * 持续任务：管理剪贴板同步服务（ClipboardSyncService）的回调订阅生命周期。
 *
 * 职责：
 * - 启动/停止 ClipboardSyncService（订阅远程变化、本地上传、历史等回调）
 * - onConfigChanged 更新后台运行开关标志
 *
 * 远程连接生命周期由 RemoteClipboardMonitorTask 管理。
 * 生命周期由 LongRunningTaskManager 统一管理。
 */

import { LongRunningTask } from './LongRunningTask';
import { getClipboardSyncService } from '../services/sync/ClipboardSyncService';
import { configService } from '../services/ConfigService';

class ClipboardSyncTask extends LongRunningTask {
  readonly name = 'clipboardSync';

  async start(): Promise<void> {
    await getClipboardSyncService().start();
  }

  async stop(): Promise<void> {
    await getClipboardSyncService().stop();
  }

  isRunning(): boolean {
    return getClipboardSyncService().isStarted();
  }

  override async onConfigChanged(): Promise<void> {
    const cfg = await configService.getConfig();
    getClipboardSyncService().onConfigChanged(cfg);
  }
}

export const clipboardSyncTask = new ClipboardSyncTask();
