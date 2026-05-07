/**
 * Text Utilities
 * 文本相关的工具函数
 */

import { ClipboardContentType } from '../types/api';

/**
 * Check if text is invalid (undefined or null)
 * Empty string is considered valid
 */
export const isTextInvalid = (text: unknown): text is undefined | null => {
  return text === undefined || text === null;
};

/**
 * 格式化文件大小为人类可读字符串
 * @param bytes 字节数
 * @param decimals 小数位数，默认为 1
 * @returns 格式化后的字符串，如 "1.5 MB"
 */
export function formatFileSize(bytes: number, decimals: number = 1): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}

/**
 * 截断文本到指定长度
 * @param text 要截断的文本
 * @param maxLength 最大长度，默认为 100
 * @returns 截断后的文本，超出部分用 "..." 表示
 */
export function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Format timestamp to readable date string
 */
export const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
};

/**
 * Get clipboard type display name
 */
export const getClipboardTypeName = (type: ClipboardContentType): string => {
  const typeNames = {
    Text: '文本',
    Image: '图片',
    File: '文件',
    Group: '文件组',
  };
  return typeNames[type] || '未知';
};

/**
 * Format size with type awareness
 * Text type shows character count with locale formatting
 * Other types show file size
 */
export const formatSizeWithType = (bytes?: number, type?: string): string => {
  if (!bytes) return '';
  if (type === 'Text') {
    return bytes.toLocaleString('zh-CN');
  }
  return formatFileSize(bytes);
};

/**
 * Validate URL format
 */
export const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};
