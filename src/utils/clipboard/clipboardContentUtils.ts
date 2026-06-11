import { File, Directory } from 'expo-file-system';
import { nativeCopyFile, nativeUnzipFile } from 'native-util';
import { calculateFileProfileHash, calculateTextHash } from '@/utils/hash';
import { prepareTempFilePath } from '@/utils/fileStorage';
import { saveFileToDirectory } from '@/utils/fileActions';
import type { ClipboardContent } from '@/types/clipboard';
import type { ClipboardContentType } from '@/types/api';

function guessContentType(mimeType: string | null | undefined): ClipboardContentType {
  if (!mimeType) return 'File';
  if (mimeType.startsWith('image/')) return 'Image';
  return 'File';
}

export async function createContentFromText(
  text: string,
  options?: { signal?: AbortSignal }
): Promise<ClipboardContent> {
  const profileHash = await calculateTextHash(text, options?.signal);
  return {
    type: 'Text',
    text,
    profileHash,
    localClipboardHash: profileHash,
    hasData: false,
    timestamp: Date.now(),
  };
}

export interface CreateContentFromFileOptions {
  signal?: AbortSignal;
}

export async function createContentFromFile(
  sourceUri: string,
  fileName: string,
  mimeType?: string | null,
  fileSize?: number,
  options?: CreateContentFromFileOptions
): Promise<ClipboardContent> {
  const contentType: ClipboardContentType = guessContentType(mimeType);
  const tempPath = prepareTempFilePath(fileName);
  const sourceFile = new File(sourceUri);

  await nativeCopyFile(sourceFile.uri, tempPath);

  const profileHash = await calculateFileProfileHash(tempPath, fileName, options?.signal);
  const resolvedSize = fileSize ?? sourceFile.size;

  return {
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
}

/**
 * 保存剪贴板内容数据到指定目录
 *
 * @param content 剪贴板内容
 * @param directoryUri 目标目录 URI（必需）
 */
export async function saveContentDataToDirectory(
  content: ClipboardContent,
  directoryUri: string
): Promise<void> {
  if (!content.fileUri) {
    throw new Error('No file data to save');
  }

  // 检查目标目录是否存在
  const targetDir = new Directory(directoryUri);
  if (!targetDir.exists) {
    throw new Error(`Target directory does not exist: ${directoryUri}`);
  }

  const fileName = content.fileName || 'file';

  // Group 类型：直接解压缩到目标目录
  if (content.type === 'Group') {
    await nativeUnzipFile(content.fileUri, directoryUri);
    return;
  }

  // 其他类型：直接保存文件
  await saveFileToDirectory(content.fileUri, directoryUri, fileName);
}
