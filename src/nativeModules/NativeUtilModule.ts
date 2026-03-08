/**
 * NativeUtilModule – hash, file copy, streaming upload & download wrapper (Android Only)
 *
 * 对应同名 Kotlin 模块 NativeUtilModule，四类功能统一封装：
 *   - nativeCopyFile          文件流式拷贝（不经过 JS/JVM 堆内存）
 *   - nativeCalculateFileHash SHA-256 哈希（后台 IO 线程，支持进度回调与取消）
 *   - nativeUploadFile        HTTP PUT 流式上传（每次仅占 8 KB 缓冲，支持取消）
 *   - nativeDownloadFile      HTTP GET 流式下载（每次仅占 8 KB 缓冲，支持取消）
 */

import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

interface NativeUtilModuleInterface {
  calculateFileHash(fileUri: string, jobId: string): Promise<string>;
  cancelJob(jobId: string): void;
  copyFile(srcUri: string, destUri: string): Promise<void>;
  uploadFile(
    url: string,
    headers: Record<string, string>,
    fileUri: string,
    jobId: string
  ): Promise<void>;
  downloadFile(
    url: string,
    headers: Record<string, string>,
    fileUri: string,
    jobId: string
  ): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

// ---------------------------------------------------------------------------
// Module & emitter initialization
// ---------------------------------------------------------------------------

const _module: NativeUtilModuleInterface | null =
  Platform.OS === 'android' ? (NativeModules.NativeUtilModule ?? null) : null;

const _emitter = _module ? new NativeEventEmitter(NativeModules.NativeUtilModule) : null;

// ---------------------------------------------------------------------------
// Availability flags
// ---------------------------------------------------------------------------

export const isNativeModuleAvailable = _module !== null;

/** @alias isNativeModuleAvailable */
export const isNativeCopyAvailable = _module !== null;

/** @alias isNativeModuleAvailable */
export const isNativeHashModuleAvailable = _module !== null;

// ---------------------------------------------------------------------------
// Job ID generator (JS side)
// ---------------------------------------------------------------------------

let _counter = 0;
function generateJobId(prefix: string): string {
  _counter += 1;
  return `${prefix}_${Date.now()}_${_counter}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 将 srcUri 流式拷贝到 destUri，不把文件读入 JS/JVM 内存。
 * destUri 支持 SAF content:// URI 或普通 file:// URI。
 */
export async function nativeCopyFile(srcUri: string, destUri: string): Promise<void> {
  if (!_module) {
    throw new Error('NativeUtilModule is not available on this platform');
  }
  await _module.copyFile(srcUri, destUri);
}

/**
 * 使用原生 SHA-256 计算文件哈希，在 Android IO 线程执行，不阻塞 JS 线程。
 *
 * @param fileUri    文件路径（支持 `file://` URI 或裸路径）
 * @param signal     可选的 AbortSignal，abort 时自动取消原生侧计算
 * @param onProgress 可选进度回调，范围 0~1，每个 4MB chunk 触发一次
 * @returns          SHA-256 大写十六进制字符串
 */
export async function nativeCalculateFileHash(
  fileUri: string,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!_module) {
    throw new Error('NativeUtilModule is not available on this platform');
  }

  const jobId = generateJobId('hash');

  const progressSub =
    onProgress && _emitter
      ? _emitter.addListener('HashProgress', (event: { jobId: string; progress: number }) => {
          if (event.jobId === jobId) {
            onProgress(event.progress);
          }
        })
      : null;

  const abortHandler = () => _module!.cancelJob(jobId);
  signal?.addEventListener('abort', abortHandler);

  try {
    return await _module.calculateFileHash(fileUri, jobId);
  } catch (error) {
    if (
      error instanceof Error &&
      ((error as { code?: string }).code === 'CANCELLED' ||
        error.message === 'Hash calculation was cancelled')
    ) {
      const abortError = new Error('Operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    progressSub?.remove();
  }
}

/**
 * 以 PUT 方式将本地文件流式上传到 HTTP/HTTPS 端点。
 * 每次仅持有 8KB 缓冲，不将文件内容读入 JVM/JS 堆内存。
 *
 * @param url      上传目标 URL
 * @param headers  请求头（含 Authorization、Content-Type 等）
 * @param fileUri  本地文件 URI（file:// 或裸路径）
 * @param signal   可选 AbortSignal，触发时取消上传
 */
export async function nativeUploadFile(
  url: string,
  headers: Record<string, string>,
  fileUri: string,
  signal?: AbortSignal
): Promise<void> {
  if (!_module) {
    throw new Error('NativeUtilModule is not available on this platform');
  }

  if (signal?.aborted) {
    throw new DOMException('Upload aborted', 'AbortError');
  }

  const jobId = generateJobId('upload');

  let abortListener: (() => void) | null = null;
  if (signal) {
    abortListener = () => _module!.cancelJob(jobId);
    signal.addEventListener('abort', abortListener);
  }

  try {
    await _module.uploadFile(url, headers, fileUri, jobId);
  } finally {
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  }
}

/**
 * 以 GET 方式将 HTTP/HTTPS 端点内容流式下载到本地文件。
 * 每次仅持有 8KB 缓冲，不将文件内容读入 JVM/JS 堆内存。
 *
 * @param url      下载目标 URL
 * @param headers  请求头（含 Authorization 等）
 * @param fileUri  本地文件 URI（file:// 或裸路径）
 * @param signal   可选 AbortSignal，触发时取消下载
 */
export async function nativeDownloadFile(
  url: string,
  headers: Record<string, string>,
  fileUri: string,
  signal?: AbortSignal
): Promise<void> {
  if (!_module) {
    throw new Error('NativeUtilModule is not available on this platform');
  }

  if (signal?.aborted) {
    throw new DOMException('Download aborted', 'AbortError');
  }

  const jobId = generateJobId('download');

  let abortListener: (() => void) | null = null;
  if (signal) {
    abortListener = () => _module!.cancelJob(jobId);
    signal.addEventListener('abort', abortListener);
  }

  try {
    await _module.downloadFile(url, headers, fileUri, jobId);
  } finally {
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  }
}
