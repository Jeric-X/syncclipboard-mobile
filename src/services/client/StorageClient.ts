import type { ClipboardContent } from '@/types/clipboard';
import { getAPIClient } from '../ClientFactory';
import type { ProgressInfo } from 'native-util';
import type { ProgressCallback } from '../history/HistoryTransferQueue';
import { clipboardContentToItem } from '@/utils/clipboard/convert';
import { historyService } from '../history/HistoryService';
import { prepareTempFilePath } from '@/utils/fileStorage';
import { calculateFileProfileHash } from '@/utils/hash';
import { ISyncClipboardAPI, type DownloadProgressCallback } from '@/api/clients/APIClient';
import { HistorySyncStatus } from '@/types/clipboard';
import { File } from 'expo-file-system';

async function downloadAndAddToHistory(
  content: ClipboardContent,
  apiClient: ISyncClipboardAPI,
  hasData: boolean,
  signal?: AbortSignal,
  onProgress?: DownloadProgressCallback
): Promise<ClipboardContent> {
  const needsDownload = hasData && content.fileName;

  if (!needsDownload) {
    return content;
  }

  let fileUri: string | undefined;

  // 仅在 profileHash 不为空时查询历史记录缓存
  if (content.profileHash) {
    const historyItem = await historyService.getItem(content.profileHash);
    if (historyItem?.fileUri) {
      const cachedFile = new File(historyItem.fileUri);
      if (cachedFile.exists) {
        fileUri = historyItem.fileUri;
      }
    }
  }

  // 缓存未命中，流式下载到临时目录，避免加载进内存
  if (!fileUri) {
    const fileName = content.fileName || 'data';
    const destUri = prepareTempFilePath(fileName);
    fileUri = await apiClient.downloadFile(fileName, destUri, signal, onProgress);
  }

  // 如果 profileHash 为空，下载完成后重新计算
  let profileHash = content.profileHash;
  if (!profileHash) {
    profileHash = await calculateFileProfileHash(fileUri, content.fileName || 'data');
  }

  let updatedContent: ClipboardContent = {
    ...content,
    fileUri,
    profileHash,
  };

  // 写入历史记录
  try {
    const item = clipboardContentToItem(updatedContent, {
      hasData,
      profileHash: profileHash || '',
      syncStatus: HistorySyncStatus.Synced,
    });
    await historyService.addItem(item);

    // addItem 内部会将文件移动到历史目录，重新读取以获取最新的 fileUri
    if (profileHash) {
      const storedItem = await historyService.getItem(profileHash);
      if (storedItem?.fileUri) {
        updatedContent = { ...updatedContent, fileUri: storedItem.fileUri };
      }
    }
  } catch (error) {
    console.error('[StorageClient] Failed to add to history:', error);
  }

  return updatedContent;
}

export async function downloadForStorage(
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
        if (progress) {
          progress({
            progress: info.progress,
            bytesTransferred: info.bytesTransferred,
            totalBytes: info.totalBytes,
          });
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

export async function uploadForStorage(
  content: ClipboardContent,
  progress?: ProgressCallback,
  signal?: AbortSignal
): Promise<void> {
  const apiClient = await getAPIClient();
  await apiClient.putContent(content, {
    signal,
    onProgress: progress
      ? (info: ProgressInfo) => {
          progress({
            progress: info.progress,
            bytesTransferred: info.bytesTransferred,
            totalBytes: info.totalBytes,
          });
        }
      : undefined,
  });
}
