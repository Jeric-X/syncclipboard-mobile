/** Headless 服务运行时存活统计；每次调试统计会话一条，前后台切换不拆分记录。 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  formatStatisticsText,
  type StatisticsFormatting,
} from '../services/statistics/statisticsFormatting';
import {
  readStatisticsSnapshot,
  mergeStatisticsHeartbeat,
} from '../services/statistics/statisticsPersistence';

const STORAGE_KEY = '@headless-lifetime-statistics';
const HEARTBEAT_KEY = '@headless-lifetime-statistics/heartbeat';
export const MAX_STATISTICS_RECORDS = 10_000;

export interface HeadlessLifetimeRecord {
  /** 启动时间（ISO 字符串） */
  startedAt: string;
  /** 最后确认存活时间，不代表精确退出时间 */
  lastHeartbeat: string;
}

interface StatisticsData {
  headlessLifetimeRecords: HeadlessLifetimeRecord[];
}

interface StatisticsState {
  data: StatisticsData;
  isLoaded: boolean;
  load: () => Promise<void>;
  recordSessionStart: (startedAt: string, lastHeartbeat?: string) => Promise<void>;
  updateHeartbeat: (lastHeartbeat?: string) => Promise<void>;
  stopRecording: () => Promise<void>;
  clear: () => Promise<void>;
  getStatisticsText: (formatting: StatisticsFormatting) => string;
}

interface StatisticsDeps {
  storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;
  now: () => Date;
}

/** 注入存储和时钟，串行处理加载、心跳及清除，防止旧写入恢复已清除记录。 */
export function createStatisticsStore({ storage, now }: StatisticsDeps) {
  let queue = Promise.resolve();
  let activeStartedAt: string | null = null;
  let revision = 0;
  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };

  return create<StatisticsState>((set, get) => {
    const load = async (): Promise<void> => {
      if (get().isLoaded) return;
      const snapshot = readStatisticsSnapshot(
        await storage.getItem(STORAGE_KEY),
        MAX_STATISTICS_RECORDS
      );
      const records = mergeStatisticsHeartbeat(snapshot, await storage.getItem(HEARTBEAT_KEY));
      revision = snapshot.revision;
      set({ data: { headlessLifetimeRecords: records }, isLoaded: true });
    };
    const save = async (records: HeadlessLifetimeRecord[]): Promise<void> => {
      const data = { headlessLifetimeRecords: records };
      const nextRevision = revision + 1;
      await storage.setItem(STORAGE_KEY, JSON.stringify({ ...data, revision: nextRevision }));
      revision = nextRevision;
      set({ data });
    };
    return {
      data: { headlessLifetimeRecords: [] },
      isLoaded: false,
      load: () => enqueue(load),
      recordSessionStart: (startedAt, lastHeartbeat = now().toISOString()) =>
        enqueue(async () => {
          await load();
          if (activeStartedAt !== null) return;
          await save(
            [{ startedAt, lastHeartbeat }, ...get().data.headlessLifetimeRecords].slice(
              0,
              MAX_STATISTICS_RECORDS
            )
          );
          activeStartedAt = startedAt;
        }),
      updateHeartbeat: (lastHeartbeat = now().toISOString()) =>
        enqueue(async () => {
          await load();
          if (activeStartedAt === null) return;
          const records = [...get().data.headlessLifetimeRecords];
          const record = {
            startedAt: activeStartedAt,
            // 排队中的心跳可能早于手动清除，不能产生负时长。
            lastHeartbeat: lastHeartbeat < activeStartedAt ? activeStartedAt : lastHeartbeat,
          };
          // 清除后下一次心跳从清除时间开始新一段，不恢复之前的记录。
          if (records.length === 0) records.push(record);
          else records[0] = record;
          // 历史不变时仅写入一个活动心跳，避免每 5 秒重写整个历史快照。
          await storage.setItem(HEARTBEAT_KEY, JSON.stringify({ revision, record }));
          set({ data: { headlessLifetimeRecords: records } });
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
      getStatisticsText: (formatting) =>
        formatStatisticsText(
          get().data.headlessLifetimeRecords,
          MAX_STATISTICS_RECORDS,
          formatting
        ),
    };
  });
}

export const useStatisticsStore = createStatisticsStore({
  storage: AsyncStorage,
  now: () => new Date(),
});
