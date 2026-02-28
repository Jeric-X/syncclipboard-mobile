/**
 * Clipboard Type Converter
 * 剪贴板内容与 API DTO 之间的类型转换
 */

import { ProfileDto, ClipboardContent, ClipboardContentType } from '@/types';
import { calculateTextHash } from '@/utils/hash';

/**
 * 将 ClipboardContent 转换为 ProfileDto
 */
export async function contentToProfileDto(content: ClipboardContent): Promise<ProfileDto> {
  const { type, text = '', profileHash, fileName, fileSize } = content;

  // 计算 profileHash（如果没有提供）
  const calculatedProfileHash = profileHash || (text ? await calculateTextHash(text) : undefined);

  switch (type) {
    case 'Text':
      return {
        type: 'Text',
        text,
        hash: calculatedProfileHash,
        hasData: false,
      };

    case 'Image':
      return {
        type: 'Image',
        text: text || '[图片]',
        hash: calculatedProfileHash,
        hasData: true,
        dataName: fileName,
        size: fileSize,
      };

    case 'File':
      return {
        type: 'File',
        text: text || fileName || '[文件]',
        hash: calculatedProfileHash,
        hasData: true,
        dataName: fileName,
        size: fileSize,
      };

    case 'Group':
      return {
        type: 'Group',
        text: text || '[文件组]',
        hash: calculatedProfileHash,
        hasData: true,
        dataName: fileName,
        size: fileSize,
      };

    default:
      throw new Error(`Unsupported clipboard type: ${type}`);
  }
}

/**
 * 将 ProfileDto 转换为 ClipboardContent
 */
export function profileDtoToContent(profile: ProfileDto): ClipboardContent {
  const { type, text, hash, hasData, dataName, size } = profile;

  const baseContent: ClipboardContent = {
    type: type as ClipboardContentType,
    text,
    profileHash: hash,
    timestamp: Date.now(), // 添加当前时间戳
  };

  if (hasData) {
    switch (type) {
      case 'Image':
        return {
          ...baseContent,
          fileName: dataName,
          fileSize: size,
        };

      case 'File':
      case 'Group':
        return {
          ...baseContent,
          fileName: dataName,
          fileSize: size,
        };
    }
  }

  return baseContent;
}

/**

 * 从 MIME 类型获取文件扩展名
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'text/plain': 'txt',
    'text/html': 'html',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/json': 'json',
    'application/xml': 'xml',
  };

  return mimeToExt[mimeType.toLowerCase()] || 'bin';
}

/**
 * 从文件名获取扩展名
 */
export function getExtensionFromFileName(fileName: string): string {
  const match = fileName.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : 'bin';
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * 获取剪贴板类型的显示名称
 */
export function getClipboardTypeDisplayName(type: ClipboardContentType): string {
  const displayNames: Record<ClipboardContentType, string> = {
    Text: '文本',
    Image: '图片',
    File: '文件',
    Group: '文件组',
  };

  return displayNames[type] || '未知';
}

/**
 * 获取剪贴板类型的图标名称（可用于 UI 图标）
 */
export function getClipboardTypeIcon(type: ClipboardContentType): string {
  const icons: Record<ClipboardContentType, string> = {
    Text: 'text',
    Image: 'image',
    File: 'file',
    Group: 'folder',
  };

  return icons[type] || 'help';
}

/**
 * 截断文本预览
 */
export function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * 验证剪贴板内容
 */
export function validateClipboardContent(content: ClipboardContent): boolean {
  if (!content || !content.type) {
    return false;
  }

  switch (content.type) {
    case 'Text':
      return typeof content.text === 'string' && content.text.length > 0;

    case 'Image':
      return Boolean(content.fileUri || content.fileName);

    case 'File':
    case 'Group':
      return Boolean(content.fileUri || content.fileName);

    default:
      return false;
  }
}

/**
 * 剪贴板项目复制结果
 */
export interface CopyResult {
  success: boolean;
  message: string;
}

/**
 * 复制剪贴板项目到系统剪贴板
 * @param item 剪贴板项目（可以是 ClipboardContent 或 ClipboardItem）
 * @param clipboardManager 剪贴板管理器实例
 * @returns 复制结果
 */
export async function copyClipboardItem(
  item: {
    type: string;
    text?: string;
    fileUri?: string;
    profileHash?: string;
  },
  clipboardManager: {
    setClipboardContent: (content: ClipboardContent) => Promise<void>;
    setImageContent: (uri: string) => Promise<void>;
  }
): Promise<CopyResult> {
  try {
    if (item.type === 'Text' && item.text) {
      await clipboardManager.setClipboardContent({
        type: 'Text',
        text: item.text,
        profileHash: item.profileHash,
      });
      return { success: true, message: '已复制到剪贴板' };
    }

    if (item.type === 'Image' && item.fileUri) {
      await clipboardManager.setImageContent(item.fileUri);
      return { success: true, message: '图片已复制到剪贴板' };
    }

    return { success: false, message: '暂不支持此类型的快速复制' };
  } catch (error) {
    console.error('[copyClipboardItem] Failed to copy:', error);
    return { success: false, message: '复制失败' };
  }
}
