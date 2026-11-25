import type { ClipboardContent } from '@/types/clipboard';
import type { ProgressCallback } from '../history/HistoryTransferQueue';
import { configService } from '../ConfigService';
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
  ): Promise<void> {
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
