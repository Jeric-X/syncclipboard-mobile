/**
 * API Related Types
 */

/**
 * 剪贴板类型枚举
 */
export type ClipboardContentType = 'Text' | 'Image' | 'File' | 'Group';

/**
 * 剪贴板配置 DTO
 * 与服务器端 ProfileDto 对应
 */
export interface ProfileDto {
  /** 剪贴板内容类型 */
  type: ClipboardContentType;

  /** SHA256 哈希值（用于去重和验证） */
  hash?: string;

  /** 预览文本或完整文本内容 */
  text: string;

  /** 是否有额外的数据文件（如图片、文件等） */
  hasData: boolean;

  /** 数据文件名 */
  dataName?: string;

  /** 文件大小（字节） */
  size?: number;
}

/**
 * 服务器配置
 */
export interface ServerConfig {
  /** 服务器类型 */
  type: 'standalone' | 'webdav';

  /** 服务器 URL */
  url: string;

  /** 用户名 */
  username?: string;

  /** 密码（加密存储） */
  password?: string;

  /** 是否启用自动同步 */
  autoSync?: boolean;

  /** 同步间隔（秒） */
  syncInterval?: number;

  /** 是否启用通知 */
  notificationEnabled?: boolean;
}

/**
 * 同步操作类型
 */
export type SyncOperation = 'upload' | 'download' | 'bidirectional';

/**
 * API 同步结果
 */
export interface APISyncResult {
  /** 是否成功 */
  success: boolean;

  /** 操作类型 */
  operation: SyncOperation;

  /** 同步的内容 */
  profile?: ProfileDto;

  /** 错误信息 */
  error?: string;

  /** 同步时间戳 */
  timestamp: number;
}

/**
 * 服务器信息
 */
export interface ServerInfo {
  /** 服务器版本 */
  version: string;

  /** 服务器时间 */
  serverTime: Date;

  /** 是否在线 */
  online: boolean;
}
