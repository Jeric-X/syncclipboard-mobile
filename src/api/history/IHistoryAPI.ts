/**
 * History API Interface
 * 历史记录 API 接口定义
 */

import { ProgressInfo } from 'native-util';
import {
  HistoryRecordDto,
  HistoryRecordUpdateDto,
  HistoryQueryParams,
  HistoryStatisticsDto,
} from '@/types/history';
import { ClipboardContentType } from '@/types/api';

/**
 * History API 接口
 */
export interface IHistoryAPI {
  queryRecords(params: HistoryQueryParams, signal?: AbortSignal): Promise<HistoryRecordDto[]>;
  getRecord(profileId: string, signal?: AbortSignal): Promise<HistoryRecordDto>;
  updateRecord(
    type: ClipboardContentType,
    profileId: string,
    update: HistoryRecordUpdateDto,
    signal?: AbortSignal
  ): Promise<HistoryRecordDto>;
  downloadData(
    profileId: string,
    destinationUri: string,
    signal?: AbortSignal,
    onProgress?: (info: ProgressInfo) => void
  ): Promise<string>;
  uploadRecord(
    record: HistoryRecordDto,
    fileUri?: string,
    signal?: AbortSignal,
    onProgress?: (info: ProgressInfo) => void
  ): Promise<HistoryRecordDto>;
  getStatistics(signal?: AbortSignal): Promise<HistoryStatisticsDto>;
  getServerTime(signal?: AbortSignal): Promise<Date>;
}
