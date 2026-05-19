import type { ProgressInfo } from 'native-util';
import { useHistoryStore } from '@/stores/historyStore';
import { getAPIClient } from '@/services';
import { SyncManager } from '@/services/sync/SyncManager';
import type { ClipboardContent } from '@/types/clipboard';
import { createHistoryItem, HistorySyncStatus } from '@/types/clipboard';
import { calculateTextHash } from '@/utils/hash';

export interface UploadFileOptions {
  signal?: AbortSignal;
  onProgress?: (stage: string, progress?: ProgressInfo) => void;
}

export async function uploadTextAndAddToHistory(
  text: string,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const profileHash = await calculateTextHash(text, options?.signal);

  SyncManager.getInstance().setLastUploadedHash(profileHash);

  const content: ClipboardContent = {
    type: 'Text',
    text,
    profileHash,
    localClipboardHash: profileHash,
    hasData: false,
    timestamp: Date.now(),
  };

  const apiClient = await getAPIClient();
  await apiClient.putContent(content, { signal: options?.signal });

  const historyItem = createHistoryItem({
    type: 'Text',
    text,
    profileHash,
    hasData: false,
    timestamp: Date.now(),
    syncStatus: HistorySyncStatus.Synced,
  });
  await useHistoryStore.getState().addItem(historyItem);
}

export async function uploadFileAndAddToHistory(
  content: ClipboardContent,
  options?: UploadFileOptions
): Promise<void> {
  if (!content.profileHash) {
    throw new Error('profileHash is required');
  }

  SyncManager.getInstance().setLastUploadedHash(content.profileHash);

  const historyItem = createHistoryItem({
    type: content.type,
    text: content.text,
    profileHash: content.profileHash,
    hasData: content.hasData,
    dataName: content.fileName,
    size: content.fileSize,
    timestamp: content.timestamp ?? Date.now(),
    fileUri: content.fileUri,
  });
  await useHistoryStore.getState().addItem(historyItem);

  const apiClient = await getAPIClient();
  options?.onProgress?.('正在上传文件…');
  await apiClient.putContent(content, {
    signal: options?.signal,
    onProgress: (info) => options?.onProgress?.('正在上传文件…', info),
  });

  await useHistoryStore.getState().updateItem(content.profileHash, { synced: true });
}
