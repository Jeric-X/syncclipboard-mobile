/**
 * Conversion Utilities
 * 转换工具函数
 */

import { HistoryRecordDto } from '@/types/history';
import { HistoryItem, HistorySyncStatus, createHistoryItem } from '@/types/clipboard';
import { ClipboardContentType, ProfileDto } from '@/types/api';
import { ClipboardContent } from '@/types';
import { calculateContentHash } from '@/utils/hash';

// ─── ProfileDto ↔ ClipboardContent ────────────────────────────────────────────

export interface ContentToProfileDtoOptions {
  signal?: AbortSignal;
}

/**
 * 将 ClipboardContent 转换为 ProfileDto
 */
export async function contentToProfileDto(
  content: ClipboardContent,
  options?: ContentToProfileDtoOptions
): Promise<ProfileDto> {
  let { type, text = '', profileHash, fileName, fileSize, fileUri } = content;

  if (!profileHash) {
    profileHash = await calculateContentHash(content, options?.signal);
  }

  switch (type) {
    case 'Text': {
      if (fileUri && fileName) {
        return {
          type: 'Text',
          text,
          hash: profileHash,
          hasData: true,
          dataName: fileName,
          size: fileSize,
        };
      }
      return { type: 'Text', text, hash: profileHash, hasData: false };
    }
    case 'Image':
      return {
        type: 'Image',
        text: text || '[图片]',
        hash: profileHash,
        hasData: true,
        dataName: fileName,
        size: fileSize,
      };
    case 'File':
      return {
        type: 'File',
        text: text || fileName || '[文件]',
        hash: profileHash,
        hasData: true,
        dataName: fileName,
        size: fileSize,
      };
    case 'Group':
      return {
        type: 'Group',
        text: text || '[文件组]',
        hash: profileHash,
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
    timestamp: Date.now(),
    hasData,
  };

  if (hasData) {
    switch (type) {
      case 'Text':
        return { ...baseContent, fileName: dataName, fileSize: size || text?.length || 0 };
      case 'Image':
        return { ...baseContent, fileName: dataName, fileSize: size };
      case 'File':
      case 'Group':
        return { ...baseContent, fileName: dataName, fileSize: size };
    }
  }

  if (type === 'Text') {
    return { ...baseContent, fileSize: size || text?.length || 0 };
  }

  return baseContent;
}

// ─── MIME / 文件扩展名工具 ────────────────────────────────────────────────────

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

export function getExtensionFromFileName(fileName: string): string {
  const match = fileName.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : 'bin';
}

// ─── 剪贴板类型辅助 ───────────────────────────────────────────────────────────

export function getClipboardTypeDisplayName(type: ClipboardContentType): string {
  const displayNames: Record<ClipboardContentType, string> = {
    Text: '文本',
    Image: '图片',
    File: '文件',
    Group: '文件组',
  };
  return displayNames[type] || '未知';
}

export function getClipboardTypeIcon(type: ClipboardContentType): string {
  const icons: Record<ClipboardContentType, string> = {
    Text: 'text',
    Image: 'image',
    File: 'file',
    Group: 'folder',
  };
  return icons[type] || 'help';
}

export function validateClipboardContent(content: ClipboardContent): boolean {
  if (!content || !content.type) return false;
  switch (content.type) {
    case 'Text':
      return typeof content.text === 'string' && content.text.length > 0;
    case 'Image':
    case 'File':
    case 'Group':
      return Boolean(content.fileUri || content.fileName);
    default:
      return false;
  }
}

// ─── ClipboardContent → ClipboardItem ────────────────────────────────────────

/**
 * 将 ClipboardContent 转换为 ClipboardItem，填充默认元数据。
 * @param content 剪贴板内容
 * @param overrides 覆盖默认字段（如 syncStatus、hasRemoteData 等）
 */
export function clipboardContentToItem(
  content: ClipboardContent,
  overrides?: Partial<HistoryItem>
): HistoryItem {
  return createHistoryItem({
    type: content.type,
    text: content.text,
    profileHash: content.profileHash || '',
    hasData: content.hasData,
    dataName: content.fileName,
    size: content.fileSize,
    timestamp: content.timestamp || Date.now(),
    fileUri: content.fileUri,
    ...overrides,
  });
}

export function historyItemToContent(item: HistoryItem): ClipboardContent {
  return {
    type: item.type,
    text: item.text,
    fileUri: item.fileUri,
    fileName: item.dataName,
    fileSize: item.size,
    profileHash: item.profileHash,
    hasData: item.hasData,
  };
}

// ─── HistoryRecordDto ↔ ClipboardItem ────────────────────────────────────────

/**
 * 将 HistoryRecordDto 转换为 ClipboardItem
 */
export function dtoToHistoryItem(dto: HistoryRecordDto): HistoryItem {
  return {
    type: dto.type as ClipboardContentType,
    text: dto.text || '',
    profileHash: dto.hash,
    hasData: dto.hasData || false,
    size: dto.size ?? 0,
    timestamp: dto.createTime ? new Date(dto.createTime).getTime() : Date.now(),
    starred: dto.starred ?? false,
    pinned: dto.pinned ?? false,
    syncStatus: HistorySyncStatus.Synced,
    version: dto.version ?? 0,
    lastModified: dto.lastModified ? new Date(dto.lastModified).getTime() : Date.now(),
    lastAccessed: dto.lastAccessed ? new Date(dto.lastAccessed).getTime() : Date.now(),
    isDeleted: dto.isDeleted ?? false,
    hasRemoteData: dto.hasData ?? false,
    isLocalFileReady: false,
  };
}

/**
 * 将 ClipboardItem 转换为 HistoryRecordDto
 */
export function historyItemToDto(item: HistoryItem): HistoryRecordDto {
  const hash = item.profileHash.includes('-')
    ? item.profileHash.split('-').slice(1).join('-')
    : item.profileHash;

  return {
    hash,
    type: item.type as 'Text' | 'Image' | 'File',
    text: item.text,
    createTime: item.timestamp ? new Date(item.timestamp).toISOString() : undefined,
    lastModified: item.lastModified ? new Date(item.lastModified).toISOString() : undefined,
    lastAccessed: item.lastAccessed ? new Date(item.lastAccessed).toISOString() : undefined,
    starred: item.starred,
    pinned: item.pinned,
    size: item.size,
    hasData: item.hasData,
    version: item.version,
    isDeleted: item.isDeleted,
  };
}
