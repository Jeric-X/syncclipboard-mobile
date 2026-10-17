import { useStatisticsStore, type AppLifetimeRecord } from '../stores/statisticsStore';

const EMPTY_RECORDS: AppLifetimeRecord[] = [];

/** 关闭弹窗时返回稳定引用，避免心跳刷新整个设置页。 */
export function useStatisticsRecords(visible: boolean) {
  return useStatisticsStore((state) => (visible ? state.data.appLifetimeRecords : EMPTY_RECORDS));
}
