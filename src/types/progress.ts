export interface ProgressDetail {
  /** 阶段描述（上传时使用） */
  stage?: string;
  /** 0-1 进度 */
  progress: number;
  bytesTransferred: number;
  totalBytes: number;
}

/** 文件级别进度（多文件处理时使用） */
export interface FileProgressInfo {
  /** 当前文件序号（从 1 开始） */
  current: number;
  /** 文件总数 */
  total: number;
}

export type { ProgressInfo } from 'native-util';
