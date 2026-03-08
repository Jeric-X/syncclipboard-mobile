/**
 * Remote Clipboard Utilities
 * 远程剪贴板工具函数 - 下载文件并保存到历史记录
 */

import { ClipboardContent, ClipboardItem } from '../types/clipboard';
import { ISyncClipboardAPI } from '../services/SyncClipboardAPI';
import { historyStorage } from '../services/HistoryStorage';
import { useHistoryStore } from '../stores/historyStore';
import { prepareTempFilePath } from './fileStorage';
import { calculateFileProfileHash } from './hash';

/**
 * 下载远程文件并添加到历史记录
 * - 优先从历史记录缓存读取（避免重复下载）
 * - 缓存未命中时直接流式下载到磁盘，不把文件数据加载进内存
 * - 下载完成后将条目写入历史记录
 *
 * @param content   待填充 fileUri 的 ClipboardContent
 * @param apiClient 用于执行下载的 API 客户端
 * @param hasData   profile 是否携带附件
 * @param signal    可选的 AbortSignal 用于取消操作
 * @returns 含有 fileUri 的更新后 ClipboardContent
 */
export async function downloadAndAddToHistory(
  content: ClipboardContent,
  apiClient: ISyncClipboardAPI,
  hasData: boolean,
  signal?: AbortSignal
): Promise<ClipboardContent> {
  const needsDownload = hasData && content.fileName;

  if (!needsDownload) {
    return content;
  }

  let fileUri: string | undefined;

  // 仅在 profileHash 不为空时查询历史记录缓存
  if (content.profileHash) {
    const historyItem = await historyStorage.getItem(content.profileHash);
    if (historyItem?.fileUri) {
      const { File } = await import('expo-file-system');
      const cachedFile = new File(historyItem.fileUri);
      if (cachedFile.exists) {
        fileUri = historyItem.fileUri;
      }
    }
  }

  // 缓存未命中，流式下载到临时目录，避免加载进内存
  if (!fileUri) {
    const destUri = prepareTempFilePath(content.fileName!);
    fileUri = await apiClient.downloadFile(content.fileName!, destUri, signal);
  }

  // 如果 profileHash 为空，下载完成后重新计算
  let profileHash = content.profileHash;
  if (!profileHash) {
    profileHash = await calculateFileProfileHash(fileUri, content.fileName);
  }

  let updatedContent: ClipboardContent = {
    ...content,
    fileUri,
    profileHash,
  };

  // 写入历史记录
  try {
    const item: ClipboardItem = {
      type: updatedContent.type,
      text: updatedContent.text || '',
      profileHash: profileHash || '',
      hasData,
      dataName: updatedContent.fileName,
      size: updatedContent.fileSize,
      timestamp: updatedContent.timestamp || Date.now(),
      synced: true,
      fileUri: updatedContent.fileUri,
    };
    await useHistoryStore.getState().addItem(item);

    // addItem 内部会将文件移动到历史目录，重新读取以获取最新的 fileUri
    if (profileHash) {
      const storedItem = await historyStorage.getItem(profileHash);
      if (storedItem?.fileUri) {
        updatedContent = { ...updatedContent, fileUri: storedItem.fileUri };
      }
    }
  } catch (error) {
    console.error('[remoteClipboard] Failed to add to history:', error);
  }

  return updatedContent;
}
