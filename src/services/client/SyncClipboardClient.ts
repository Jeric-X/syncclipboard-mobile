import type { ClipboardContent } from '@/types/clipboard';
import { getHistoryTransferQueue, type ProgressCallback } from '../history/HistoryTransferQueue';
import { historyService } from '../history/HistoryService';
import { clipboardContentToItem } from '@/utils/clipboard/convert';
import { HistorySyncStatus } from '@/types/clipboard';

export async function downloadForSyncClipboard(
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
    });
    await historyService.addItem(historyItem);
  } catch (e) {
    console.error('[ClientService] Failed to add history item before download:', e);
  }

  return await queue.executeImmediateDownload(remoteContent, progress, signal);
}

export async function uploadForSyncClipboard(
  content: ClipboardContent,
  progress?: ProgressCallback,
  signal?: AbortSignal
): Promise<ClipboardContent> {
  if (!content.profileHash) {
    throw new Error('No profileHash in content');
  }

  const queue = getHistoryTransferQueue();
  return await queue.executeImmediateUpload(content, progress, signal);
}
