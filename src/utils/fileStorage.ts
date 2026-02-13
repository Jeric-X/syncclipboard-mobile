/**
 * File Storage Utility
 * 文件存储工具 - 管理剪贴板文件的本地存储
 * 使用 Expo File System 新 API (File 和 Directory 类)
 */

import { Paths, File, Directory } from 'expo-file-system';

/**
 * 文件存储目录结构
 * clipboards/
 *   images/     - 图片文件
 *   files/      - 普通文件
 */
const BASE_DIR = new Directory(Paths.document, 'clipboards');
const IMAGE_DIR = new Directory(BASE_DIR, 'images');
const FILE_DIR = new Directory(BASE_DIR, 'files');

/**
 * 初始化文件存储目录
 */
export async function initFileStorage(): Promise<void> {
  try {
    // 使用新的 Directory API 创建目录（如果不存在）
    if (!BASE_DIR.exists) {
      BASE_DIR.create();
    }
    if (!IMAGE_DIR.exists) {
      IMAGE_DIR.create();
    }
    if (!FILE_DIR.exists) {
      FILE_DIR.create();
    }

    console.log('[FileStorage] Initialized directories:', {
      base: BASE_DIR.uri,
      images: IMAGE_DIR.uri,
      files: FILE_DIR.uri,
    });
  } catch (error) {
    console.error('[FileStorage] Failed to initialize directories:', error);
    throw error;
  }
}

/**
 * ArrayBuffer 转 Base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 保存文件到本地存储
 * @param type 文件类型（Image 或 File）
 * @param hash 文件hash值
 * @param data 文件数据（ArrayBuffer）
 * @param extension 文件扩展名（可选，如 .jpg, .png, .pdf）
 * @returns 文件URI
 */
export async function saveFile(
  type: 'Image' | 'File',
  hash: string,
  data: ArrayBuffer,
  extension?: string
): Promise<string> {
  try {
    // 确保目录存在
    await initFileStorage();

    // 确定保存目录
    const dir = type === 'Image' ? IMAGE_DIR : FILE_DIR;

    // 生成文件名：使用hash值，保留扩展名
    const fileName = extension ? `${hash}${extension}` : hash;

    // 使用新的 File API
    const file = new File(dir, fileName);

    // 检查文件是否已存在
    if (file.exists) {
      console.log('[FileStorage] File already exists:', file.uri);
      return file.uri;
    }

    // 将 ArrayBuffer 转换为 Uint8Array
    const uint8Array = new Uint8Array(data);

    // 写入文件
    file.write(uint8Array);

    console.log('[FileStorage] File saved:', file.uri);
    return file.uri;
  } catch (error) {
    console.error('[FileStorage] Failed to save file:', error);
    throw error;
  }
}

/**
 * 根据 type 和 hash 获取文件URI
 * @param type 文件类型
 * @param hash 文件hash值
 * @param extension 文件扩展名（可选）
 * @returns 文件URI，如果文件不存在返回 null
 */
export async function getFileUri(
  type: 'Image' | 'File',
  hash: string,
  extension?: string
): Promise<string | null> {
  try {
    const dir = type === 'Image' ? IMAGE_DIR : FILE_DIR;
    const fileName = extension ? `${hash}${extension}` : hash;

    // 使用新的 File API 检查文件是否存在
    const file = new File(dir, fileName);

    return file.exists ? file.uri : null;
  } catch (error) {
    console.error('[FileStorage] Failed to get file URI:', error);
    return null;
  }
}

/**
 * 删除文件
 * @param type 文件类型
 * @param hash 文件hash值
 * @param extension 文件扩展名（可选）
 */
export async function deleteFile(
  type: 'Image' | 'File',
  hash: string,
  extension?: string
): Promise<void> {
  try {
    const dir = type === 'Image' ? IMAGE_DIR : FILE_DIR;
    const fileName = extension ? `${hash}${extension}` : hash;

    // 使用新的 File API
    const file = new File(dir, fileName);

    if (file.exists) {
      file.delete();
      console.log('[FileStorage] File deleted:', file.uri);
    }
  } catch (error) {
    console.error('[FileStorage] Failed to delete file:', error);
    throw error;
  }
}

/**
 * 清理所有剪贴板文件
 */
export async function clearAllFiles(): Promise<void> {
  try {
    // 使用新的 Directory API
    if (BASE_DIR.exists) {
      BASE_DIR.delete();
      console.log('[FileStorage] All files cleared');
    }
  } catch (error) {
    console.error('[FileStorage] Failed to clear files:', error);
    throw error;
  }
}

/**
 * 获取存储统计信息
 */
export async function getStorageStats(): Promise<{
  imageCount: number;
  fileCount: number;
  totalSize: number;
}> {
  try {
    let imageCount = 0;
    let fileCount = 0;
    let totalSize = 0;

    // 统计图片目录
    try {
      if (IMAGE_DIR.exists) {
        const images = IMAGE_DIR.list();
        imageCount = images.length;

        for (const imageName of images) {
          try {
            const imageFile = new File(IMAGE_DIR, imageName);
            if (imageFile.exists) {
              const info = imageFile.info();
              totalSize += info.size || 0;
            }
          } catch (error) {
            // 忽略单个文件错误
          }
        }
      }
    } catch (error) {
      // 目录不存在或其他错误
    }

    // 统计文件目录
    try {
      if (FILE_DIR.exists) {
        const files = FILE_DIR.list();
        fileCount = files.length;

        for (const fileName of files) {
          try {
            const file = new File(FILE_DIR, fileName);
            if (file.exists) {
              const info = file.info();
              totalSize += info.size || 0;
            }
          } catch (error) {
            // 忽略单个文件错误
          }
        }
      }
    } catch (error) {
      // 目录不存在或其他错误
    }

    return {
      imageCount,
      fileCount,
      totalSize,
    };
  } catch (error) {
    console.error('[FileStorage] Failed to get storage stats:', error);
    return {
      imageCount: 0,
      fileCount: 0,
      totalSize: 0,
    };
  }
}

/**
 * 直接下载文件并保存到本地（优化内存占用）
 * @param type 文件类型（Image 或 File）
 * @param hash 文件hash值
 * @param downloadUrl 下载URL
 * @param headers 请求头（用于认证等）
 * @param extension 文件扩展名（可选，如 .jpg, .png, .pdf）
 * @returns 文件URI
 */
export async function downloadAndSaveFile(
  type: 'Image' | 'File',
  hash: string,
  downloadUrl: string,
  headers?: Record<string, string>,
  extension?: string
): Promise<string> {
  try {
    // 确保目录存在
    await initFileStorage();

    // 确定保存目录
    const dir = type === 'Image' ? IMAGE_DIR : FILE_DIR;

    // 生成文件名：使用hash值，保留扩展名
    const fileName = extension ? `${hash}${extension}` : hash;

    // 使用新的 File API 检查文件是否已存在
    const file = new File(dir, fileName);

    if (file.exists) {
      console.log('[FileStorage] File already exists:', file.uri);
      return file.uri;
    }

    // 直接下载到文件系统（不占用内存）
    console.log('[FileStorage] Downloading file to:', file.uri);
    await File.downloadFileAsync(downloadUrl, file, {
      headers: headers || {},
    });

    console.log('[FileStorage] File downloaded successfully:', file.uri);
    return file.uri;
  } catch (error) {
    console.error('[FileStorage] Failed to download and save file:', error);
    throw error;
  }
}

/**
 * 从文件名中提取扩展名
 */
export function getFileExtension(fileName: string): string {
  const match = fileName.match(/\.[^.]+$/);
  return match ? match[0] : '';
}
