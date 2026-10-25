import { getHistorySyncService, type HistorySyncService } from './HistorySyncService';
import { requestServiceRuntime } from '../ServiceRuntime';
import { configService } from '../ConfigService';
import { isHistorySyncEnabled } from '../../utils/config';
import { HistoryAPINotInitializedError } from '../../errors';

/** 历史页等待统一运行时就绪；仅真正关闭/不支持同步时返回 null，启动故障原样上抛。 */
export async function getReadyHistorySyncService(): Promise<HistorySyncService | null> {
  if (!isHistorySyncEnabled(await configService.getConfig())) return null;
  if (!getHistorySyncService().isInitialized()) await requestServiceRuntime();
  // 等待期间可能切换服务器或关闭同步，必须重新读取状态和服务实例。
  if (!isHistorySyncEnabled(await configService.getConfig())) return null;
  const service = getHistorySyncService();
  if (!service.isInitialized()) throw new HistoryAPINotInitializedError();
  return service;
}
