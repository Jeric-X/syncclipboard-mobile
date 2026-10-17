/** 应用存活统计；每次调试统计会话一条，前后台切换不拆分记录。 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@statistics';
export const MAX_STATISTICS_RECORDS = 10_000;

export interface AppLifetimeRecord {
  /** 启动时间（ISO 字符串） */
  startedAt: string;
  /** 最后确认存活时间，不代表精确退出时间 */
  lastHeartbeat: string;
  /** 迁移的旧记录只覆盖后台任务，不能当作完整应用存活记录 */
  legacyBackground?: boolean;
}

interface StatisticsData {
  appLifetimeRecords: AppLifetimeRecord[];
}

interface StatisticsState {
  data: StatisticsData;
  isLoaded: boolean;
  load: () => Promise<void>;
  recordAppStart: (startedAt: string) => Promise<void>;
  updateHeartbeat: () => Promise<void>;
  stopRecording: () => Promise<void>;
  clear: () => Promise<void>;
  getStatisticsText: () => string;
}

interface StatisticsDeps {
  storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;
  now: () => Date;
}

function readRecords(raw: string | null): AppLifetimeRecord[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    const legacy = !Array.isArray(data.appLifetimeRecords);
    const records: unknown = legacy ? data.backgroundTaskRecords : data.appLifetimeRecords;
    if (!Array.isArray(records)) return [];
    return records
      .filter(
        (record): record is AppLifetimeRecord =>
          record !== null &&
          typeof record === 'object' &&
          typeof record.startedAt === 'string' &&
          typeof record.lastHeartbeat === 'string' &&
          Number.isFinite(Date.parse(record.startedAt)) &&
          Number.isFinite(Date.parse(record.lastHeartbeat))
      )
      .slice(0, MAX_STATISTICS_RECORDS)
      .map((record) => ({
        startedAt: record.startedAt,
        lastHeartbeat: record.lastHeartbeat,
        ...(legacy || record.legacyBackground ? { legacyBackground: true } : {}),
      }));
  } catch {
    return [];
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours % 24 > 0) parts.push(`${hours % 24}小时`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60}分钟`);
  if (parts.length === 0) parts.push(`${seconds}秒`);
  return parts.join(' ');
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** 查看列表与复制文本使用相同的记录格式。 */
export function formatLifetimeRecord(record: AppLifetimeRecord, index: number): string {
  return [
    `${index + 1}. ${record.legacyBackground ? '后台记录（旧版）' : '应用存活'}`,
    `启动: ${formatTime(record.startedAt)}`,
    `最后活跃: ${formatTime(record.lastHeartbeat)}`,
    `持续: ${formatDuration(Date.parse(record.lastHeartbeat) - Date.parse(record.startedAt))}`,
  ].join('\n');
}

/** 注入存储和时钟，串行处理加载、心跳及清除，防止旧写入恢复已清除记录。 */
export function createStatisticsStore({ storage, now }: StatisticsDeps) {
  let queue = Promise.resolve();
  let activeStartedAt: string | null = null;
  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };

  return create<StatisticsState>((set, get) => {
    const load = async (): Promise<void> => {
      if (get().isLoaded) return;
      const records = readRecords(await storage.getItem(STORAGE_KEY));
      set({ data: { appLifetimeRecords: records }, isLoaded: true });
    };
    const save = async (records: AppLifetimeRecord[]): Promise<void> => {
      const data = { appLifetimeRecords: records };
      await storage.setItem(STORAGE_KEY, JSON.stringify(data));
      set({ data });
    };
    return {
      data: { appLifetimeRecords: [] },
      isLoaded: false,
      load: () => enqueue(load),
      recordAppStart: (startedAt) =>
        enqueue(async () => {
          await load();
          if (activeStartedAt !== null) return;
          await save(
            [
              { startedAt, lastHeartbeat: now().toISOString() },
              ...get().data.appLifetimeRecords,
            ].slice(0, MAX_STATISTICS_RECORDS)
          );
          activeStartedAt = startedAt;
        }),
      updateHeartbeat: () =>
        enqueue(async () => {
          await load();
          if (activeStartedAt === null) return;
          const records = [...get().data.appLifetimeRecords];
          const record = { startedAt: activeStartedAt, lastHeartbeat: now().toISOString() };
          // 清除后下一次心跳从清除时间开始新一段，不恢复之前的记录。
          if (records.length === 0) records.push(record);
          else records[0] = record;
          await save(records);
        }),
      stopRecording: () =>
        enqueue(async () => {
          activeStartedAt = null;
        }),
      clear: () =>
        enqueue(async () => {
          await load();
          const clearedAt = now().toISOString();
          await save([]);
          if (activeStartedAt !== null) activeStartedAt = clearedAt;
        }),
      getStatisticsText: () => {
        const records = get().data.appLifetimeRecords;
        return [
          '=== 应用存活统计 ===',
          `记录数: ${records.length} / ${MAX_STATISTICS_RECORDS}`,
          ...records.map(formatLifetimeRecord),
          ...(records.length === 0 ? ['无记录'] : []),
        ].join('\n\n');
      },
    };
  });
}

export const useStatisticsStore = createStatisticsStore({
  storage: AsyncStorage,
  now: () => new Date(),
});
