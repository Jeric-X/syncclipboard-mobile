import { getHistorySyncService, type HistorySyncService } from './HistorySyncService';
import { requestServiceRuntime } from '../ServiceRuntime';
import { configService } from '../ConfigService';
import { isHistorySyncEnabled } from '../../utils/config';
import { longRunningTaskManager } from '../../longRunningTask/LongRunningTaskManager';
import { HistoryAPINotInitializedError } from '../../errors';

/** 历史页等待统一运行时就绪；仅真正关闭/不支持同步时返回 null，启动故障原样上抛。 */
export async function getReadyHistorySyncService(): Promise<HistorySyncService | null> {
  if (!isHistorySyncEnabled(await configService.getConfig())) return null;
  if (!getHistorySyncService().isInitialized()) {
    await requestServiceRuntime();
    // 运行时可在个别任务启动失败后就绪；通过协调器重试，避免在 UI 另建生命周期。
    if (!getHistorySyncService().isInitialized()) await longRunningTaskManager.refresh(true);
  }
  // 等待期间可能切换服务器或关闭同步，必须重新读取状态和服务实例。
  if (!isHistorySyncEnabled(await configService.getConfig())) return null;
  const service = getHistorySyncService();
  if (!service.isInitialized()) throw new HistoryAPINotInitializedError();
  return service;
}
