import type { ClipboardContent } from '@/types/clipboard';
import { getAPIClient } from '../ClientFactory';
import { getHistoryTransferQueue, type ProgressCallback } from '../history/HistoryTransferQueue';
import { historyService } from '../history/HistoryService';
import { clipboardContentToItem } from '@/utils/clipboard/convert';
import { HistorySyncStatus } from '@/types/clipboard';
import { downloadAndAddToHistory } from '@/utils/remoteClipboard';
import type { ProgressInfo } from 'native-util';
import { configService } from '../ConfigService';

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
      return await this.downloadForSyncClipboard(content, progress, signal);
    } else {
      return await this.downloadForWebDAV(content, progress, signal);
    }
  }

  private async downloadForWebDAV(
    remoteContent: ClipboardContent,
    progress?: ProgressCallback,
    signal?: AbortSignal
  ): Promise<ClipboardContent> {
    try {
      const apiClient = await getAPIClient();
      const updatedContent = await downloadAndAddToHistory(
        remoteContent,
        apiClient,
        remoteContent.hasData,
        signal,
        (info: ProgressInfo) => {
          const progressInfo = {
            progress: info.progress,
            bytesTransferred: info.bytesTransferred,
            totalBytes: info.totalBytes,
          };

          if (progress) {
            progress(progressInfo);
          }
        }
      );
      return updatedContent;
    } catch (error) {
      const err = error as Error;
      const msg = err?.message?.toLowerCase() ?? '';
      if (err?.name === 'AbortError' || msg.includes('abort') || msg.includes('cancel')) {
        return remoteContent;
      }
      throw error;
    }
  }

  private async downloadForSyncClipboard(
    remoteContent: ClipboardContent,
    progress?: ProgressCallback,
    signal?: AbortSignal
  ): Promise<ClipboardContent> {
    if (!remoteContent.profileHash) {
      throw new Error('No profileHash in remoteContent');
    }

    const queue = getHistoryTransferQueue();

    try {
      const historyItem = clipboardContentToItem(remoteContent, {
        syncStatus: HistorySyncStatus.NeedSync,
        hasRemoteData: true,
        isLocalFileReady: false,
      });
      await historyService.addItem(historyItem);
    } catch (e) {
      console.error('[ClientService] Failed to add history item before download:', e);
    }

    return await queue.executeImmediateDownload(remoteContent, progress, signal);
  }
}

export function getClientService(): ClientService {
  return ClientService.getInstance();
}
