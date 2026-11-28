import { readFileChunks } from '@/utils/readFileChunks';
import { md5 } from '@noble/hashes/legacy';
import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { createUploadTask, FileSystemSessionType } from 'expo-file-system/legacy';
import type { ProgressInfo } from 'native-util';

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw Object.assign(new Error('Upload aborted'), { name: 'AbortError' });
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function stringMD5Base64(value: string): string {
  return base64(md5(new TextEncoder().encode(value)));
}

export async function fileMD5Base64(uri: string, signal?: AbortSignal): Promise<string> {
  const hash = md5.create();
  await readFileChunks(uri, (chunk) => hash.update(chunk), signal);
  return base64(hash.digest());
}

async function upload(
  method: 'POST' | 'PUT',
  url: string,
  headers: Record<string, string>,
  uri: string,
  signal?: AbortSignal,
  onProgress?: (info: ProgressInfo) => void
): Promise<void> {
  checkCancelled(signal);
  const task = createUploadTask(
    url,
    uri,
    { httpMethod: method, headers, sessionType: FileSystemSessionType.FOREGROUND },
    onProgress &&
      (({ totalBytesSent, totalBytesExpectedToSend }) => {
        onProgress({
          progress: totalBytesExpectedToSend > 0 ? totalBytesSent / totalBytesExpectedToSend : 0,
          bytesTransferred: totalBytesSent,
          totalBytes: totalBytesExpectedToSend,
        });
      })
  );
  const cancel = () => {
    void task.cancelAsync().catch(() => {});
  };
  signal?.addEventListener('abort', cancel);
  try {
    const result = await task.uploadAsync();
    checkCancelled(signal);
    if (!result) throw new Error('Upload ended without a response');
    if (result.status < 200 || result.status >= 300) {
      let response: unknown = result.body;
      try {
        response = JSON.parse(result.body);
      } catch {
        /* 非 JSON 错误正文原样保留。 */
      }
      throw Object.assign(new Error(`Upload failed (HTTP ${result.status})`), {
        statusCode: result.status,
        response,
      });
    }
  } catch (error) {
    // SDK 55 的 UploadTask 在原生 Promise 拒绝时仍持有进度订阅。
    cancel();
    checkCancelled(signal);
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

export function uploadFile(
  url: string,
  headers: Record<string, string>,
  uri: string,
  signal?: AbortSignal,
  onProgress?: (info: ProgressInfo) => void
) {
  return upload('PUT', url, headers, uri, signal, onProgress);
}

export async function uploadMultipart(
  url: string,
  headers: Record<string, string>,
  fields: Record<string, string>,
  fileUri?: string,
  signal?: AbortSignal,
  onProgress?: (info: ProgressInfo) => void
) {
  checkCancelled(signal);
  const boundary = randomUUID();
  const body = new File(Paths.cache, `upload-${boundary}.tmp`);
  body.create();
  try {
    const output = body.open();
    const encoder = new TextEncoder();
    const write = (text: string) => output.writeBytes(encoder.encode(text));
    try {
      for (const [name, value] of Object.entries(fields)) {
        write(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
        );
      }
      if (fileUri) {
        const filename = decodeURIComponent(
          new URL(fileUri).pathname.split('/').pop() ?? ''
        ).replace(/["\r\n]/g, encodeURIComponent);
        write(
          `--${boundary}\r\nContent-Disposition: form-data; name="data"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
        );
        await readFileChunks(fileUri, (chunk) => output.writeBytes(chunk), signal);
        write('\r\n');
      }
      write(`--${boundary}--\r\n`);
    } finally {
      output.close();
    }
    await upload(
      'POST',
      url,
      { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body.uri,
      signal,
      onProgress
    );
  } finally {
    body.delete();
  }
}
