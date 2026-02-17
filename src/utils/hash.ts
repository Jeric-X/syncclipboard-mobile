/**
 * Hash Utilities
 * 提供 SHA256 等哈希计算功能
 */

import * as Crypto from 'expo-crypto';
import { sha256 } from 'js-sha256';

/**
 * 计算字符串的 SHA256 hash
 * @param text 要计算 hash 的文本
 * @returns SHA256 hash 字符串（小写十六进制）
 */
export async function calculateTextHash(text: string): Promise<string> {
  if (!text) {
    return '';
  }

  try {
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, {
      encoding: Crypto.CryptoEncoding.HEX,
    });
    return hash.toLowerCase();
  } catch (error) {
    console.error('[HashUtils] Failed to calculate text hash:', error);
    throw new Error('Failed to calculate text hash');
  }
}

/**
 * 计算 base64 数据的 SHA256 hash（用于本地变化检测）
 * 直接对 base64 字符串计算 hash，快速但与文件内容 hash 不同
 * @param base64Data base64 编码的数据
 * @returns SHA256 hash 字符串（小写十六进制）
 */
export async function calculateBase64Hash(base64Data: string): Promise<string> {
  if (!base64Data) {
    return '';
  }

  try {
    // 直接对 base64 字符串计算 hash（用于快速比较）
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64Data, {
      encoding: Crypto.CryptoEncoding.HEX,
    });
    return hash.toLowerCase();
  } catch (error) {
    console.error('[HashUtils] Failed to calculate base64 hash:', error);
    throw new Error('Failed to calculate base64 hash');
  }
}

/**
 * 计算 base64 数据的二进制内容 SHA256 hash（用于服务器上传）
 * 先将 base64 解码为二进制，然后计算 hash
 * @param base64Data base64 编码的数据
 * @returns SHA256 hash 字符串（小写十六进制）
 */
export async function calculateBase64ContentHash(base64Data: string): Promise<string> {
  if (!base64Data) {
    return '';
  }

  try {
    // 将 base64 解码为二进制字符串
    const binaryString = atob(base64Data);
    
    // 将二进制字符串转换为字节数组
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // 使用 js-sha256 计算 SHA256（它可以正确处理 Uint8Array）
    const hash = sha256(bytes);
    
    return hash.toLowerCase();
  } catch (error) {
    console.error('[HashUtils] Failed to calculate base64 content hash:', error);
    throw new Error('Failed to calculate base64 content hash');
  }
}

/**
 * 计算文件的 SHA256 hash
 * @param fileUri 文件 URI
 * @returns SHA256 hash 字符串（小写十六进制）
 */
export async function calculateFileHash(fileUri: string): Promise<string> {
  if (!fileUri) {
    return '';
  }

  try {
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, fileUri, {
      encoding: Crypto.CryptoEncoding.HEX,
    });
    return hash.toLowerCase();
  } catch (error) {
    console.error('[HashUtils] Failed to calculate file hash:', error);
    throw new Error('Failed to calculate file hash');
  }
}

/**
 * 计算 Blob 数据的 SHA256 hash
 * @param blob Blob 数据
 * @returns SHA256 hash 字符串（小写十六进制）
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

    return hash.toLowerCase();
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
