import type { ClipboardContent } from '@/types/clipboard';
import type { ProgressCallback } from '../history/HistoryTransferQueue';
import { configService } from '../ConfigService';
import type { ServerConfig } from '@/types/api';
import { getAPIClient } from '../ClientFactory';
import { contentToProfileDto } from '@/utils/clipboard/convert';
import { downloadForStorage, uploadForStorage } from './StorageClient';
import { downloadForSyncClipboard, uploadForSyncClipboard } from './SyncClipboardClient';

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
    signal?: AbortSignal,
    selected?: ServerConfig
  ): Promise<ClipboardContent | void> {
    const server = selected ?? (await configService.getActiveServer());
    if (!server) throw new Error('No active server configured');
    if (server.type === 'syncclipboard' && (await configService.getConfig()).enableHistorySync) {
      return uploadForSyncClipboard(content, progress, signal, server);
    }
    return uploadForStorage(content, progress, signal, server);
  }

  async setRemoteClipboard(
    content: ClipboardContent,
    progress?: ProgressCallback,
    signal?: AbortSignal,
    selected?: ServerConfig
  ): Promise<void> {
    const server = selected ?? (await configService.getActiveServer());
    if (!server) throw new Error('No active server configured');
    if (content.hasData) {
      // 存储后端由 putContent 发布 profile；历史队列只上传附件，需继续发布。
      const historyContent = await this.uploadData(content, progress, signal, server);
      if (!historyContent) return;
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const apiClient = await getAPIClient(server);
    const profile = await contentToProfileDto(content, { signal });
    await apiClient.putClipboard(profile, signal);
  }
}

export function getClientService(): ClientService {
  return ClientService.getInstance();
}
