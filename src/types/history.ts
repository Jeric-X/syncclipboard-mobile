/**
 * History Types
 * 历史记录相关类型定义
 */

/**
 * 历史记录 DTO（服务器格式）
 */
export interface HistoryRecordDto {
  hash: string;
  type: 'Text' | 'Image' | 'File';
  text?: string;
  createTime?: string;
  lastModified?: string;
  lastAccessed?: string;
  starred?: boolean;
  pinned?: boolean;
  size?: number;
  hasData?: boolean;
  version?: number;
  isDeleted?: boolean;
}

/**
 * 历史记录更新 DTO
 */
export interface HistoryRecordUpdateDto {
  starred?: boolean;
  pinned?: boolean;
  isDelete?: boolean;
  version?: number;
  lastModified?: string;
  lastAccessed?: string;
}

/**
 * 历史记录查询参数
 */
export interface HistoryQueryParams {
  page?: number;
  before?: string;
  after?: string;
  modifiedAfter?: string;
  types?: number;
  searchText?: string;
  starred?: boolean;
  sortByLastAccessed?: boolean;
}

/**
 * 历史记录统计 DTO
 */
export interface HistoryStatisticsDto {
  totalCount: number;
  starredCount: number;
  deletedCount: number;
  activeCount: number;
  totalFileSizeMB: number;
}

/**
 * 类型过滤位掩码
 */
export const ProfileTypeFilter = {
  Text: 1,
  Image: 2,
  File: 4,
  Group: 8,
  All: 15,
  FileAndGroup: 12,
} as const;
