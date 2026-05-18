/**
 * Sync Manager Types
 * 同步管理器相关类型定义
 */

import { ServerConfig } from './api';
import { ClipboardContent } from './clipboard';

/**
 * 同步方向
 */
export enum SyncDirection {
  /** 上传 */
  Upload = 'upload',
  /** 下载 */
  Download = 'download',
}

/**
 * 同步状态
 */
export enum SyncStatus {
  /** 空闲 */
  Idle = 'idle',
  /** 同步中 */
  Syncing = 'syncing',
  /** 成功 */
  Success = 'success',
  /** 失败 */
  Failed = 'failed',
  /** 冲突 */
  Conflict = 'conflict',
}

/**
 * 冲突解决策略
 */
export enum ConflictResolution {
  /** 使用本地版本 */
  UseLocal = 'local',
  /** 使用远程版本 */
  UseRemote = 'remote',
  /** 使用最新版本（基于时间戳） */
  UseNewest = 'newest',
  /** 询问用户 */
  Ask = 'ask',
}

/**
 * 同步配置
 */
export interface SyncConfig {
  /** 服务器配置 */
  server: ServerConfig;

  /** 同步间隔（毫秒）- 仅自动模式 */
  interval?: number;

  /** 冲突解决策略 */
  conflictResolution: ConflictResolution;

  /** 是否同步大文件 */
  syncLargeFiles: boolean;

  /** 大文件阈值（字节） */
  largeFileThreshold: number;

  /** 最大重试次数 */
  maxRetries: number;

  /** 重试延迟（毫秒） */
  retryDelay: number;
}

/**
 * 同步结果
 */
export interface SyncResult {
  /** 是否成功 */
  success: boolean;

  /** 同步方向 */
  direction: SyncDirection;

  /** 错误信息 */
  error?: string;

  /** 同步的 profile hash */
  profileHash?: string;

  /** 是否跳过（内容未变化） */
  skipped?: boolean;

  /** 是否有冲突 */
  hasConflict?: boolean;

  /** 本次同步的剪贴板内容（仅下载成功且有实际内容时填充） */
  content?: ClipboardContent;

  /** 同步耗时（毫秒） */
  duration?: number;
}
