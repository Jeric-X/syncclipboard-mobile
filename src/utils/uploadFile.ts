/**
 * uploadFileAndAddToHistory
 * 将本地文件（content:// 或 file:// URI）复制到 temp 目录、写入历史记录并上传到服务器。
 * 供 HomeScreen 右上角"上传文件"菜单和 ShareReceiveScreen 共同调用。
 */

import { File } from 'expo-file-system';
import { nativeCopyFile } from '@/nativeModules/NativeUtilModule';
import { calculateFileProfileHash } from '@/utils/hash';
import { prepareTempFilePath } from '@/utils/fileStorage';
import { useHistoryStore } from '@/stores/historyStore';
import { createAPIClient } from '@/services';
import type { ClipboardContent } from '@/types/clipboard';
import type { ClipboardContentType } from '@/types/api';
import type { ServerConfig } from '@/types/api';

function guessContentType(mimeType: string | null | undefined): ClipboardContentType {
  if (!mimeType) return 'File';
  if (mimeType.startsWith('image/')) return 'Image';
  return 'File';
}

export interface UploadFileOptions {
  signal?: AbortSignal;
  /** 各阶段进度文字回调，供 UI 动态更新 loading 文本 */
  onProgress?: (stage: string) => void;
}

/**
 * @param sourceUri   原始文件 URI（content:// 或 file://）
 * @param fileName    文件名（含扩展名）
 * @param mimeType    MIME 类型（可选，用于推断内容类型）
 * @param fileSize    文件大小（字节，可选，若为 undefined 则从复制后文件读取）
 * @param activeServer 目标服务器配置
 * @param options     可传入 AbortSignal 以支持取消
 */
export async function uploadFileAndAddToHistory(
  sourceUri: string,
  fileName: string,
  mimeType: string | null | undefined,
  fileSize: number | undefined,
  activeServer: ServerConfig,
  options?: UploadFileOptions
): Promise<void> {
  const contentType: ClipboardContentType = guessContentType(mimeType);
  const tempPath = prepareTempFilePath(fileName);
  var sourceFile = new File(sourceUri);
  options?.onProgress?.('正在复制文件…');
  await nativeCopyFile(sourceFile.uri, tempPath);

  options?.onProgress?.('正在计算哈希…');
  const profileHash = await calculateFileProfileHash(tempPath, fileName);
  const resolvedSize = fileSize ?? sourceFile.size;

  const content: ClipboardContent = {
    type: contentType,
    text: fileName,
    fileUri: tempPath,
    fileName,
    fileSize: resolvedSize,
    profileHash,
    localClipboardHash: profileHash,
    hasData: true,
    timestamp: Date.now(),
  };

  const savedItem = await useHistoryStore.getState().addItem({
    type: contentType,
    text: fileName,
    profileHash,
    hasData: true,
    dataName: fileName,
    size: resolvedSize,
    timestamp: Date.now(),
    fileUri: tempPath,
    synced: false,
  });

  // 使用移动到历史记录目录后的最新 fileUri
  content.fileUri = savedItem.fileUri ?? tempPath;

  const apiClient = createAPIClient(activeServer);
  options?.onProgress?.('正在上传文件…');
  await apiClient.putContent(content, options);

  await useHistoryStore.getState().updateItem(profileHash, { synced: true });
}
