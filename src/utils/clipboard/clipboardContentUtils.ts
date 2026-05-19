import { File } from 'expo-file-system';
import { nativeCopyFile } from 'native-util';
import { calculateFileProfileHash, calculateTextHash } from '@/utils/hash';
import { prepareTempFilePath } from '@/utils/fileStorage';
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
