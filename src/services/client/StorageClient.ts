import type { ClipboardContent } from '@/types/clipboard';
import { getAPIClient } from '../ClientFactory';
import { downloadAndAddToHistory } from '@/utils/remoteClipboard';
import type { ProgressInfo } from 'native-util';
import type { ProgressCallback } from '../history/HistoryTransferQueue';

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
