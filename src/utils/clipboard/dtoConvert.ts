/**
 * DTO Conversion Utilities
 * DTO 转换工具函数
 */

import { HistoryRecordDto } from '@/types/history';
import { ClipboardItem, HistorySyncStatus } from '@/types/clipboard';
import { ClipboardContentType } from '@/types/api';

/**
 * 将 HistoryRecordDto 转换为 ClipboardItem
 */
export function dtoToClipboardItem(dto: HistoryRecordDto): ClipboardItem {
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
export function clipboardItemToDto(item: ClipboardItem): HistoryRecordDto {
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
