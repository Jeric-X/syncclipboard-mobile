import type { ClipboardContent } from '@/types/clipboard';
import type { ProgressCallback } from '../history/HistoryTransferQueue';
import { configService } from '../ConfigService';
import { downloadForStorage } from './StorageClient';
import { downloadForSyncClipboard } from './SyncClipboardClient';

export class ClientService {
  private static instance: ClientService;

  private constructor() {}

  static getInstance(): ClientService {
    if (!ClientService.instance) {
      ClientService.instance = new ClientService();
    }
    return ClientService.instance;
  }

  async download(
    content: ClipboardContent,
    progress?: ProgressCallback,
    signal?: AbortSignal
  ): Promise<ClipboardContent> {
    const server = await configService.getActiveServer();
    if (!server) {
      throw new Error('No active server configured');
    }

    if (server.type === 'syncclipboard') {
      return downloadForSyncClipboard(content, progress, signal);
    }
    return downloadForStorage(content, progress, signal);
  }
}

export function getClientService(): ClientService {
  return ClientService.getInstance();
}
