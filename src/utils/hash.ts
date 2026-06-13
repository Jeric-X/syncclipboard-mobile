/**
 * Hash Utilities
 * 提供 SHA256 等哈希计算功能
 */

import * as Crypto from 'expo-crypto';
import { sha256 } from 'js-sha256';
import type { ClipboardContent } from '@/types';
import { isNativeHashModuleAvailable, nativeCalculateFileHash } from 'native-util';

import { isTextInvalid } from './textUtils';

function createAbortError(): Error {
  const error = new Error('Operation was aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

/**
 * 计算字符串的 SHA256 hash
 * 使用 js-sha256 在主线程计算
 * @param text 要计算 hash 的文本
 * @returns SHA256 hash 字符串（大写十六进制）
 */
export async function calculateTextHash(text: string, signal?: AbortSignal): Promise<string> {
  if (isTextInvalid(text)) {
    return '';
  }

  try {
    throwIfAborted(signal);

    // 使用 js-sha256 计算（因为支持增量更新）
    const hasher = sha256.create();
    hasher.update(text);
    const hash = hasher.hex().toUpperCase();

    throwIfAborted(signal);
    return hash;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    console.error('[HashUtils] Failed to calculate text hash:', error);
    throw new Error('Failed to calculate text hash');
  }
}

/**
 * 计算 base64 数据的 SHA256 hash（用于本地变化检测）
 * 直接对 base64 字符串计算 hash，快速但与文件内容 hash 不同
 * @param base64Data base64 编码的数据
 * @returns SHA256 hash 字符串（大写十六进制）
 */
export async function calculateBase64Hash(
  base64Data: string,
  signal?: AbortSignal
): Promise<string> {
  if (!base64Data) {
    return '';
  }

  try {
    throwIfAborted(signal);
    // 直接对 base64 字符串计算 hash（用于快速比较）
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64Data, {
      encoding: Crypto.CryptoEncoding.HEX,
    });
    throwIfAborted(signal);
    return hash.toUpperCase();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    console.error('[HashUtils] Failed to calculate base64 hash:', error);
    throw new Error('Failed to calculate base64 hash');
  }
}

/**
 * 计算 base64 数据的二进制内容 SHA256 hash（用于服务器上传）
 * 先将 base64 解码为二进制，然后计算 hash
 * @param base64Data base64 编码的数据
 * @returns SHA256 hash 字符串（大写十六进制）
 */
export async function calculateBase64ContentHash(
  base64Data: string,
  signal?: AbortSignal
): Promise<string> {
  if (!base64Data) {
    return '';
  }

  try {
    throwIfAborted(signal);

    // 将 base64 解码为二进制字符串
    const binaryString = atob(base64Data);

    // 将二进制字符串转换为字节数组
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // 使用 js-sha256 计算 SHA256
    const hash = sha256(bytes);

    throwIfAborted(signal);
    return hash.toUpperCase();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    console.error('[HashUtils] Failed to calculate base64 content hash:', error);
    throw new Error('Failed to calculate base64 content hash');
  }
}

/**
 * [内部] JS 实现的文件哈希（降级备用）
 * 流式读取文件，分块计算，周期性 yield 保持 UI 响应
 */
async function calculateFileHashJS(fileUri: string, signal?: AbortSignal): Promise<string> {
  const { File } = await import('expo-file-system');
  const file = new File(fileUri);

  const fileInfo = file.info();
  if (!fileInfo.exists) {
    throw new Error(`File not found: ${fileUri}`);
  }

  const fileHandle = file.open();
  const hasher = sha256.create();
  const chunkSize = 1024 * 1024; // 1MB 块

  try {
    const totalSize = fileInfo.size ?? 0;
    let remainingBytes = totalSize;
    let chunkCount = 0;

    while (remainingBytes > 0) {
      throwIfAborted(signal);

      const bytesToRead = Math.min(chunkSize, remainingBytes);
      const chunk = fileHandle.readBytes(bytesToRead);

      if (!chunk || chunk.length === 0) {
        break;
      }

      hasher.update(chunk);
      remainingBytes -= chunk.length;
      chunkCount += 1;

      // 周期性让出事件循环，保持 UI 响应
      if (chunkCount % 1 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  } finally {
    fileHandle.close();
  }

  return hasher.hex().toUpperCase();
}

/**
 * 计算文件的 SHA256 hash
 * 在 Android 上优先使用原生模块（异步 IO 线程，不阻塞 JS），
 * 其他平台或原生模块不可用时自动降级为 JS 实现。
 *
 * @param fileUri 文件 URI（支持 file:// 格式）
 * @param signal  可选的 AbortSignal，用于取消计算
 * @param onProgress 可选的进度回调，范围 0~1（仅原生路径支持）
 * @returns SHA256 hash 字符串（大写十六进制）
 */
export async function calculateFileHash(
  fileUri: string,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!fileUri) {
    return '';
  }

  try {
    throwIfAborted(signal);

    let hash: string;
    if (isNativeHashModuleAvailable) {
      // Android：使用原生模块，IO 线程异步执行，不阻塞 JS
      hash = await nativeCalculateFileHash(fileUri, signal, onProgress);
    } else {
      // 降级：JS 实现（expo-file-system 分块读取）
      hash = await calculateFileHashJS(fileUri, signal);
    }

    return hash;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    console.error('[HashUtils] Failed to calculate file hash:', error);
    throw new Error('Failed to calculate file hash');
  }
}

/**
 * 计算文件的 profileHash（按照服务器规则）
 * 规则：profileHash = SHA256(fileHashName + "|" + fileHash.ToUpper())
 *
 * @param fileUri 文件 URI
 * @param fileName 文件名（可选，为空时从 fileUri 提取）
 * @returns profileHash 字符串
 */
export async function calculateFileProfileHash(
  fileUri: string,
  fileName?: string,
  signal?: AbortSignal
): Promise<string> {
  throwIfAborted(signal);
  // 1. 计算文件内容的 hash
  const fileHash = await calculateFileHash(fileUri, signal);

  // 2. 获取文件名：如果没有传入，则从 fileUri 提取
  let fileHashName = fileName;
  if (!fileHashName) {
    // 从 URI 中提取文件名（支持 / 和 \ 分隔符）
    const parts = fileUri.split(/[/\\]/);
    fileHashName = parts[parts.length - 1] || 'unknown';
  }

  // 3. 按照服务器规则计算 profileHash = SHA256(fileName + "|" + fileHash)
  const combinedString = `${fileHashName}|${fileHash.toUpperCase()}`;
  const profileHash = await calculateTextHash(combinedString, signal);

  return profileHash;
}

/**
 * 计算剪贴板内容的 profileHash
 * 根据内容类型选择合适的 hash 计算方法
 *
 * @param content 剪贴板内容
 * @returns profileHash 字符串，如果无法计算则返回 undefined
 */
export async function calculateContentHash(
  content: ClipboardContent,
  signal?: AbortSignal
): Promise<string | undefined> {
  throwIfAborted(signal);
  const { type, text, fileUri, fileName } = content;

  switch (type) {
    case 'Text':
      return !isTextInvalid(text) ? await calculateTextHash(text, signal) : undefined;

    case 'Image':
    case 'File':
      return fileUri ? await calculateFileProfileHash(fileUri, fileName, signal) : undefined;

    case 'Group':
      // Group hash 在内容创建时预先计算并存储在 profileHash 中
      // 无法在此处重新计算（缺少每个文件的 hash 信息）
      return content.profileHash || undefined;
    default:
      return undefined;
  }
}

/**
 * Group 哈希条目：表示 Group 中的一个文件或目录
 */
export interface GroupEntry {
  /** 相对路径，以 / 分隔，目录需要以 / 结尾 */
  relativePath: string;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 文件大小（字节），目录为 0 */
  length: number;
  /** 文件内容的 SHA256 hash（大写十六进制），目录为空字符串 */
  contentHash: string;
}

/**
 * 按 UTF-8 字节序比较两个字符串
 * 与桌面端 ByteArrayComparer 行为一致，对于包含非 ASCII 字符（如中文）的文件名
 * 至关重要——localeCompare 会产生不同的排序结果
 */
const utf8Encoder = new TextEncoder();

function compareUtf8Bytes(a: string, b: string): number {
  const bytesA = utf8Encoder.encode(a);
  const bytesB = utf8Encoder.encode(b);
  const minLen = Math.min(bytesA.length, bytesB.length);
  for (let i = 0; i < minLen; i++) {
    if (bytesA[i] !== bytesB[i]) {
      return (bytesA[i] & 0xff) - (bytesB[i] & 0xff); // 无符号字节比较
    }
  }
  return bytesA.length - bytesB.length;
}

/**
 * 计算 Group 类型的哈希值，与桌面端 / 服务端算法一致
 *
 * 算法：
 * 1. 按相对路径的 UTF-8 字节序排序所有条目
 * 2. 目录格式：  "D|{relativePath}\0"
 *    文件格式：  "F|{relativePath}|{length}|{contentHash}\0"
 * 3. 按顺序拼接所有条目字符串
 * 4. 将拼接后的字符串编码为 UTF-8 字节
 * 5. 对字节进行 SHA256 哈希，返回大写十六进制字符串
 *
 * @param entries Group 中的条目列表
 * @returns Group 哈希值（大写十六进制）
 */
export function calculateGroupHash(entries: GroupEntry[]): string {
  // Step 1: 按 UTF-8 字节序排序（不能使用 localeCompare，非 ASCII 字符排序不同）
  const sorted = [...entries].sort((a, b) => compareUtf8Bytes(a.relativePath, b.relativePath));

  // Step 2-4: 流式生成条目字符串并计算 SHA256
  const hasher = sha256.create();

  for (const entry of sorted) {
    if (entry.isDirectory) {
      hasher.update(utf8Encoder.encode(`D|${entry.relativePath}\0`));
    } else {
      hasher.update(
        utf8Encoder.encode(`F|${entry.relativePath}|${entry.length}|${entry.contentHash}\0`)
      );
    }
  }

  return hasher.hex().toUpperCase();
}

/**
 * 计算 Blob 数据的 SHA256 hash
 * @param blob Blob 数据
 * @returns SHA256 hash 字符串（大写十六进制）
 */
export async function calculateBlobHash(blob: Blob): Promise<string> {
  try {
    // 将 Blob 转换为 ArrayBuffer
    const arrayBuffer = await blob.arrayBuffer();

    // 转换为 Uint8Array
    const uint8Array = new Uint8Array(arrayBuffer);

    // 转换为 base64 字符串
    const base64 = btoa(String.fromCharCode(...uint8Array));

    // 计算 hash
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64, {
      encoding: Crypto.CryptoEncoding.HEX,
    });

    return hash.toUpperCase();
  } catch (error) {
    console.error('[HashUtils] Failed to calculate blob hash:', error);
    throw new Error('Failed to calculate blob hash');
  }
}

/**
 * 比对两个 hash 是否相同
 * @param hash1 第一个 hash
 * @param hash2 第二个 hash
 * @returns 是否相同
 */
export function compareHash(hash1: string, hash2: string): boolean {
  if (!hash1 || !hash2) {
    return false;
  }
  return hash1.toLowerCase() === hash2.toLowerCase();
}

/**
 * 验证 hash 格式是否正确（SHA256 应该是 64 个十六进制字符）
 * @param hash hash 字符串
 * @returns 是否是有效的 SHA256 hash
 */
export function isValidHash(hash: string): boolean {
  if (!hash) {
    return false;
  }
  // SHA256 hash 应该是 64 个十六进制字符
  return /^[a-f0-9]{64}$/i.test(hash);
}
