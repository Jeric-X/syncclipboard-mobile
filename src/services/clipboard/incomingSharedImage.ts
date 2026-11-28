import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';

/** Expo 会按原文件名覆盖共享容器中的图片，接收时立即移入独立缓存。 */
export function takeSharedImage(uri: string, mimeType?: string) {
  const url = new URL(uri);
  const fileName = decodeURIComponent(url.pathname.split('/').pop() ?? '');
  if (url.protocol !== 'file:' || !fileName || fileName.includes('/')) {
    throw new Error('Invalid shared image URI');
  }
  const file = new File(uri);
  const snapshot = new File(Paths.cache, `share-${randomUUID()}${file.extension}`);
  file.move(snapshot);
  return {
    data: {
      type: 'file' as const,
      uri: snapshot.uri,
      fileName,
      mimeType: mimeType?.startsWith('image/') ? mimeType : 'image/*',
    },
    dispose: () => {
      if (snapshot.exists) snapshot.delete();
    },
  };
}
