import { File, type FileHandle } from 'expo-file-system';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';

/** 分块读取文件。SDK 55 的 iOS File.open() 要求写权限，只读附件改用原生只读句柄。 */
export async function readFileChunks(
  uri: string,
  consume: (chunk: Uint8Array) => void,
  signal?: AbortSignal
) {
  const file = new File(uri);
  if (!file.exists) throw new Error(`File not found: ${uri}`);
  let handle: FileHandle | undefined;
  try {
    handle = file.open();
  } catch {
    // 下方的只读 API 会保留实际读取错误。
  }
  try {
    const size = file.size;
    let offset = 0;
    while (offset < size) {
      if (signal?.aborted) throw Object.assign(new Error('Read aborted'), { name: 'AbortError' });
      const length = Math.min(size - offset, 1024 * 1024);
      const chunk = handle
        ? handle.readBytes(length)
        : Uint8Array.from(
            atob(
              await readAsStringAsync(uri, {
                encoding: EncodingType.Base64,
                position: offset,
                length,
              })
            ),
            (c) => c.charCodeAt(0)
          );
      if (!chunk.length) throw new Error('Unexpected end of file');
      consume(chunk);
      offset += chunk.length;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    handle?.close();
  }
}
