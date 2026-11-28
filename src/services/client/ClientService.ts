import { Platform } from 'react-native';
import type { ServerConfig } from '@/types/api';
import type { HistoryRecordDto } from '@/types/history';
import { HistorySyncStatus } from '@/types/clipboard';
import { historyService } from '../history/HistoryService';
import type { ClipboardContent } from '@/types/clipboard';
import type { ProgressCallback } from '../history/HistoryTransferQueue';
import { configService } from '../ConfigService';
import { createClientFromConfig, getAPIClient } from '../ClientFactory';
import { contentToProfileDto, historyItemToDto } from '@/utils/clipboard/convert';
import { downloadForStorage, uploadForStorage } from './StorageClient';
import { downloadForSyncClipboard, uploadForSyncClipboard } from './SyncClipboardClient';

async function confirmHistoryRecord(record: HistoryRecordDto, server: ServerConfig): Promise<void> {
  const item = await historyService.getItem(record.hash);
  if (
    !item ||
    item.isDeleted ||
    !!item.starred !== !!record.starred ||
    !!item.pinned !== !!record.pinned
  )
    return;
  const active = await configService.getActiveServer();
  if (JSON.stringify(active) !== JSON.stringify(server)) return;
  await historyService.updateItem(record.hash, {
    version: record.version,
    lastModified: record.lastModified ? Date.parse(record.lastModified) : undefined,
    syncStatus: HistorySyncStatus.Synced,
  });
}

export class ClientService {
  private static instance: ClientService;

  private constructor() {}

  static getInstance(): ClientService {
    if (!ClientService.instance) {
      ClientService.instance = new ClientService();
    }
    return ClientService.instance;
  }

  async downloadData(
    content: ClipboardContent,
    progress?: ProgressCallback,
    signal?: AbortSignal
  ): Promise<ClipboardContent> {
    const server = await configService.getActiveServer();
    if (!server) {
      throw new Error('No active server configured');
    }

    if (server.type === 'syncclipboard') {
      const config = await configService.getConfig();
      if (!config.enableHistorySync) {
        return downloadForStorage(content, progress, signal);
      }
      return downloadForSyncClipboard(content, progress, signal);
    }
    return downloadForStorage(content, progress, signal);
  }

  async uploadData(
    content: ClipboardContent,
    progress?: ProgressCallback,
    signal?: AbortSignal
  ): Promise<ClipboardContent | void> {
    const server = await configService.getActiveServer();
    if (!server) {
      throw new Error('No active server configured');
    }

    if (server.type === 'syncclipboard') {
      const config = await configService.getConfig();
      if (!config.enableHistorySync) {
        return uploadForStorage(content, progress, signal);
      }
      return uploadForSyncClipboard(content, progress, signal);
    }
    return uploadForStorage(content, progress, signal);
  }

  async setRemoteClipboard(
    content: ClipboardContent,
    progress?: ProgressCallback,
    signal?: AbortSignal
  ): Promise<ServerConfig | void> {
    if (Platform.OS === 'ios' && content.hasData) {
      // iOS 的前台客户端在同一服务器上上传附件和 profile，无需启动后台历史队列。
      const config = await configService.getConfig();
      const server = config.servers[config.activeServerIndex];
      if (!server) throw new Error('No active server configured');
      const api = createClientFromConfig(server);
      const useHistory = !!config.enableHistorySync && server.type === 'syncclipboard';
      const item =
        useHistory && content.profileHash
          ? await historyService.getItem(content.profileHash)
          : null;
      await api.putContent(content, {
        signal,
        onProgress: progress,
        history: useHistory
          ? {
              record: item ? historyItemToDto(item) : undefined,
              confirm: (record) => confirmHistoryRecord(record, server),
            }
          : undefined,
      });
      return server;
    }
    if (content.hasData) {
      await this.uploadData(content, progress, signal);
    }

    const apiClient = await getAPIClient();
    const profile = await contentToProfileDto(content, { signal });
    await apiClient.putClipboard(profile, signal);
  }
}

export function getClientService(): ClientService {
  return ClientService.getInstance();
}
