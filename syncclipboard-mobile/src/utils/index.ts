/**
 * Utility Functions
 */

import { ClipboardType } from '../types';

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
export const getClipboardTypeName = (type: ClipboardType): string => {
  const typeNames = {
    [ClipboardType.Text]: '文本',
    [ClipboardType.Image]: '图片',
    [ClipboardType.File]: '文件',
    [ClipboardType.Group]: '文件组',
  };
  return typeNames[type] || '未知';
};

/**
 * Format file size to human readable string
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

/**
 * Truncate text to specified length
 */
export const truncateText = (text: string, maxLength: number = 100): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
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
