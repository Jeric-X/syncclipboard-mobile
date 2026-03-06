/**
 * NativeUtilModule – hash wrapper (Android Only)
 * 封装 Android 原生 SHA-256 文件哈希功能，提供异步非阻塞接口，支持取消和进度回调。
 */

import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

interface NativeHashModuleInterface {
  calculateFileHash(fileUri: string, jobId: string): Promise<string>;
  cancelFileHash(jobId: string): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

// ---------------------------------------------------------------------------
// Module & emitter initialization
// ---------------------------------------------------------------------------

const _module: NativeHashModuleInterface | null =
  Platform.OS === 'android' ? (NativeModules.NativeUtilModule ?? null) : null;

const _emitter = _module ? new NativeEventEmitter(NativeModules.NativeUtilModule) : null;

/** 原生模块是否可用（仅 Android，且模块已正确注册） */
export const isNativeHashModuleAvailable = _module !== null;

// ---------------------------------------------------------------------------
// Job ID generator
// ---------------------------------------------------------------------------

let _counter = 0;
function generateJobId(): string {
  _counter += 1;
  return `hash_${Date.now()}_${_counter}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 使用原生 SHA-256 计算文件哈希。
 * 在 Android IO 线程执行，不阻塞 JS 线程。
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
    throw new Error('NativeHashModule is not available on this platform');
  }

  const jobId = generateJobId();

  // 订阅进度事件（仅在调用方需要进度时才注册，减少开销）
  const progressSub =
    onProgress && _emitter
      ? _emitter.addListener('HashProgress', (event: { jobId: string; progress: number }) => {
          if (event.jobId === jobId) {
            onProgress(event.progress);
          }
        })
      : null;

  // 将 AbortSignal 的取消信号转发给原生模块
  const abortHandler = () => _module.cancelFileHash(jobId);
  signal?.addEventListener('abort', abortHandler);

  try {
    return await _module.calculateFileHash(fileUri, jobId);
  } catch (error) {
    // 原生侧抛出取消异常时，转换为标准 AbortError
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
