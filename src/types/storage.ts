/**
 * Storage Types
 * 本地存储相关类型定义
 */

import { ServerConfig } from './api';
import { SyncMode, ConflictResolution } from './sync';

/**
 * 应用配置
 */
export interface AppConfig {
  /** 服务器配置列表 */
  servers: ServerConfig[];

  /** 当前激活的服务器索引 */
  activeServerIndex: number;

  /** 同步模式 */
  syncMode: SyncMode;

  /** 同步间隔（毫秒） */
  syncInterval: number;

  /** 冲突解决策略 */
  conflictResolution: ConflictResolution;

  /** 是否启用离线队列 */
  enableOfflineQueue: boolean;

  /** 最大离线队列大小 */
  maxOfflineQueueSize: number;

  /** 是否同步大文件 */
  syncLargeFiles: boolean;

  /** 大文件阈值（字节） */
  largeFileThreshold: number;

  /** 主题模式 */
  theme: 'light' | 'dark' | 'auto';

  /** 语言 */
  language: string;

  /** 是否启用通知 */
  enableNotifications: boolean;

  /** 是否在后台同步 */
  syncInBackground: boolean;

  /** 启动时自动同步 */
  syncOnStartup: boolean;

  /** 自动同步（检测到变化时自动上传/下载） */
  autoSync: boolean;

  /** 自动下载最大文件大小（字节），默认 5MB */
  autoDownloadMaxSize: number;
}

/**
 * 缓存项
 */
export interface CacheItem<T = unknown> {
  /** 缓存键 */
  key: string;

  /** 缓存值 */
  value: T;

  /** 创建时间戳 */
  createdAt: number;

  /** 过期时间戳（可选） */
  expiresAt?: number;

  /** 访问次数 */
  accessCount: number;

  /** 最后访问时间 */
  lastAccessedAt: number;
}

/**
 * 缓存配置
 */
export interface CacheConfig {
  /** 默认过期时间（毫秒） */
  defaultTTL: number;

  /** 最大缓存条目数 */
  maxSize: number;

  /** 清理间隔（毫秒） */
  cleanupInterval: number;
}

/**
 * 历史记录过滤器
 */
export interface HistoryFilter {
  /** 内容类型 */
  type?: string[];

  /** 起始时间 */
  startDate?: number;

  /** 结束时间 */
  endDate?: number;

  /** 搜索关键词 */
  keyword?: string;

  /** 是否仅显示标记项 */
  starredOnly?: boolean;

  /** 是否仅显示已同步项 */
  syncedOnly?: boolean;
}

/**
 * 历史记录排序
 */
export interface HistorySort {
  /** 排序字段 */
  field: 'timestamp' | 'useCount' | 'size';

  /** 排序方向 */
  order: 'asc' | 'desc';
}

/**
 * 存储统计信息
 */
export interface StorageStats {
  /** 配置大小（字节） */
  configSize: number;

  /** 缓存大小（字节） */
  cacheSize: number;

  /** 历史记录大小（字节） */
  historySize: number;

  /** 总大小（字节） */
  totalSize: number;

  /** 历史记录数量 */
  historyCount: number;

  /** 缓存条目数量 */
  cacheCount: number;

  /** 最后更新时间 */
  lastUpdated: number;
}

/**
 * 存储键常量
 */
export const STORAGE_KEYS = {
  /** 应用配置 */
  CONFIG: '@syncclipboard:config',

  /** 服务器列表 */
  SERVERS: '@syncclipboard:servers',

  /** 历史记录 */
  HISTORY: '@syncclipboard:history',

  /** 缓存前缀 */
  CACHE_PREFIX: '@syncclipboard:cache:',

  /** 同步状态 */
  SYNC_STATE: '@syncclipboard:sync:state',

  /** 统计信息 */
  STATS: '@syncclipboard:stats',

  /** 上次同步时间 */
  LAST_SYNC: '@syncclipboard:last_sync',
} as const;

/**
 * 默认应用配置
 */
export const DEFAULT_APP_CONFIG: AppConfig = {
  servers: [],
  activeServerIndex: -1,
  syncMode: 'manual' as SyncMode,
  syncInterval: 5000,
  conflictResolution: 'newest' as ConflictResolution,
  enableOfflineQueue: true,
  maxOfflineQueueSize: 100,
  syncLargeFiles: true,
  largeFileThreshold: 10 * 1024 * 1024, // 10MB
  theme: 'auto',
  language: 'zh-CN',
  enableNotifications: true,
  syncInBackground: false,
  syncOnStartup: true,
  autoSync: false,
  autoDownloadMaxSize: 5 * 1024 * 1024, // 5MB
};

/**
 * 默认缓存配置
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  defaultTTL: 30 * 60 * 1000, // 30分钟
  maxSize: 100,
  cleanupInterval: 5 * 60 * 1000, // 5分钟
};
