export interface ProgressDetail {
  /** 阶段描述（上传时使用） */
  stage?: string;
  /** 0-1 进度 */
  progress: number;
  bytesTransferred: number;
  totalBytes: number;
}

export type { ProgressInfo } from 'native-util';
