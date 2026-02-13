/**
 * Clipboard Service Types
 * 剪贴板服务相关类型定义
 */

import { ClipboardContentType } from './api';

/**
 * 剪贴板项目
 */
export interface ClipboardItem {
  /** 唯一标识符 */
  id: string;

  /** 内容类型 */
  type: ClipboardContentType;

  /** 文本内容（预览或完整） */
  text: string;

  /** 内容 hash 值 */
  hash: string;

  /** 是否有额外数据 */
  hasData: boolean;

  /** 数据文件名 */
  dataName?: string;

  /** 文件大小（字节） */
  size?: number;

  /** 创建时间戳 */
  timestamp: number;

  /** 设备名称 */
  deviceName?: string;

  /** 是否已同步 */
  synced?: boolean;
}

/**
 * 剪贴板内容
 */
export interface ClipboardContent {
  /** 内容类型 */
  type: ClipboardContentType;

  /** 文本内容 */
  text?: string;

  /** 图片 URI（本地文件路径） */
  imageUri?: string;

  /** 文件 URI（本地文件路径） */
  fileUri?: string;

  /** 文件名 */
  fileName?: string;

  /** 文件大小 */
  fileSize?: number;

  /** 内容 hash */
  hash?: string;

  /** 文件数据（二进制） */
  fileData?: ArrayBuffer;

  /** 创建时间戳 */
  timestamp?: number;
}

/**
 * 剪贴板监听器回调
 */
export type ClipboardChangeCallback = (content: ClipboardContent) => void;

/**
 * 剪贴板监听器选项
 */
export interface ClipboardMonitorOptions {
  /** 轮询间隔（毫秒），仅 iOS 使用 */
  pollingInterval?: number;

  /** 是否在应用进入后台时停止监听 */
  stopOnBackground?: boolean;

  /** 防抖延迟（毫秒） */
  debounceDelay?: number;
}

/**
 * 剪贴板历史项
 */
export interface ClipboardHistoryItem extends ClipboardItem {
  /** 是否被标记 */
  starred?: boolean;

  /** 备注 */
  note?: string;

  /** 使用次数 */
  useCount?: number;

  /** 最后使用时间 */
  lastUsed?: number;
}

/**
 * 剪贴板历史查询选项
 */
export interface ClipboardHistoryQuery {
  /** 类型筛选 */
  type?: ClipboardContentType;

  /** 搜索关键词 */
  keyword?: string;

  /** 开始时间 */
  startTime?: number;

  /** 结束时间 */
  endTime?: number;

  /** 是否只显示已标记 */
  starredOnly?: boolean;

  /** 跳过数量 */
  skip?: number;

  /** 限制数量 */
  limit?: number;

  /** 排序方式 */
  sortBy?: 'timestamp' | 'useCount' | 'lastUsed';

  /** 排序顺序 */
  sortOrder?: 'asc' | 'desc';
}
