/**
 * History Errors
 * 历史记录相关错误类
 */

import { HistoryRecordDto } from '@/types/history';

/**
 * 同步冲突错误
 */
export class SyncConflictError extends Error {
  public readonly serverRecord: HistoryRecordDto;

  constructor(message: string, serverRecord: HistoryRecordDto) {
    super(message);
    this.name = 'SyncConflictError';
    this.serverRecord = serverRecord;
  }
}

/**
 * 记录不存在错误
 */
export class RecordNotFoundError extends Error {
  public readonly profileId: string;

  constructor(profileId: string) {
    super(`Record not found: ${profileId}`);
    this.name = 'RecordNotFoundError';
    this.profileId = profileId;
  }
}
