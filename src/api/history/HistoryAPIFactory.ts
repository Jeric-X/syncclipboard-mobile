/**
 * History API Factory
 * 创建 IHistoryAPI 实例的工厂函数。
 *
 * 将 HistorySyncService.ensureInitialized 中的硬编码 SyncClipboardClient 实例化
 * 集中至此模块，明确表达"只有 syncclipboard 类型服务器支持历史记录同步"的能力边界。
 */

import { SyncClipboardClient } from '../clients/SyncClipboardClient';
import { AuthService } from '../AuthService';
import type { IHistoryAPI } from './IHistoryAPI';
import type { ServerConfig } from '@/types/api';

/**
 * 根据服务器配置创建 IHistoryAPI 实例。
 *
 * - `syncclipboard`：返回 SyncClipboardClient（实现了 IHistoryAPI）
 * - 其他类型：返回 null（不支持历史记录同步）
 */
export function createHistoryAPI(serverConfig: ServerConfig): IHistoryAPI | null {
  if (serverConfig.type !== 'syncclipboard') {
    return null;
  }

  const { url, username, password } = serverConfig;
  if (!url) return null;

  const authService = username && password ? new AuthService(username, password) : undefined;
  return new SyncClipboardClient({ baseURL: url, authService });
}
