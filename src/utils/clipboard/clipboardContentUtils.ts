import { File, Directory } from 'expo-file-system';
import { nativeCopyFile, nativeUnzipFile, nativeZipFiles } from 'native-util';
import {
  calculateFileHash,
  calculateFileProfileHash,
  calculateTextHash,
  calculateGroupHash,
} from '@/utils/hash';
import type { GroupEntry } from '@/utils/hash';
import { prepareTempFilePath } from '@/utils/fileStorage';
import { copyFileToDirectory } from '@/utils/fileActions';
import type { ClipboardContent } from '@/types/clipboard';
import type { ClipboardContentType } from '@/types/api';
import type { FileProgressInfo, ProgressInfo } from '@/types/progress';

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
  /** 多文件处理时的文件级别进度回调 */
  onProgress?: (info: FileProgressInfo) => void;
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
 * 多文件条目，用于 createContentFromMultipleFiles
 */
export interface MultipleFileEntry {
  /** 文件内容 URI（file:// 格式） */
  uri: string;
  /** 文件名（仅文件名，不含路径） */
  fileName: string;
}

export async function createContentFromMultipleFiles(
  entries: MultipleFileEntry[],
  options?: CreateContentFromFileOptions
): Promise<ClipboardContent> {
  if (!entries || entries.length === 0) {
    throw new Error('No files provided for group content');
  }

  const signal = options?.signal;

  // Step 1: 直接从源文件计算 hash（无需复制到临时存储）
  // 调用方（ShareActivity）已将 content:// URI 复制为 file:// 缓存文件，
  // 直接使用源文件可避免一次冗余的磁盘复制。
  const groupEntries: GroupEntry[] = [];
  const sourceUris: string[] = [];
  const fileNames: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    sourceUris.push(entry.uri);
    fileNames.push(entry.fileName);

    // 计算文件内容 hash（支持取消）
    const contentHash = await calculateFileHash(entry.uri, signal);

    // 上报文件级别进度
    options?.onProgress?.({ current: i + 1, total: entries.length });

    const sourceFile = new File(entry.uri);
    const fileInfo = sourceFile.info();

    groupEntries.push({
      relativePath: entry.fileName,
      isDirectory: false,
      length: fileInfo?.size ?? 0,
      contentHash: contentHash.toUpperCase(),
    });
  }

  // Step 2: 计算 Group hash
  const groupHash = calculateGroupHash(groupEntries);

  // Step 3: 直接从源文件创建 zip（支持取消）
  const timestamp = Date.now();
  const randomPart = Math.random().toString(36).substring(2, 8);
  const zipFileName = `File_${timestamp}_${randomPart}.zip`;
  const zipPath = prepareTempFilePath(zipFileName);

  await nativeZipFiles(sourceUris, zipPath, signal);

  // Step 4: 获取 zip 文件信息并返回
  const zipFile = new File(zipPath);
  const zipFileInfo = zipFile.info();
  const zipSize = zipFileInfo?.size ?? 0;

  // text 字段：文件名列表（排序后换行连接，与桌面端一致）
  const text = [...fileNames].sort().join('\n');

  return {
    type: 'Group',
    text,
    fileUri: zipPath,
    fileName: zipFileName,
    fileSize: zipSize,
    profileHash: groupHash,
    localClipboardHash: groupHash,
    hasData: true,
    timestamp,
  };
}

/**
 * 保存剪贴板内容数据到指定目录
 * - Image 类型：支持保存到目录，但建议优先使用 saveToGallery 保存到相册
 * - 其他类型（File/Text）：直接保存文件到目标目录
 *
 * @param content 剪贴板内容
 * @param directoryUri 目标目录 URI（必需）
 */
export async function saveContentDataToDirectory(
  content: ClipboardContent,
  directoryUri: string,
  signal?: AbortSignal,
  onProgress?: (info: ProgressInfo) => void
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

  // Group 类型：解压缩到目标目录
  // Downloads 根目录的回退逻辑已内置在 nativeUnzipFile 中（SAF → MediaStore），
  // JS 侧无需额外判断。
  if (content.type === 'Group') {
    await nativeUnzipFile(content.fileUri, directoryUri, signal, onProgress);
    return;
  }

  // 其他类型：直接复制文件（支持进度和取消）
  await copyFileToDirectory(content.fileUri, directoryUri, fileName, true, signal, onProgress);
}
