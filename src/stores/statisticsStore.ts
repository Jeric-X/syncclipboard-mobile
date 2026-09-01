/**
 * Statistics Store
 * 统计信息持久化存储 - 记录后台任务启动时间、持续时间等运行统计
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { calculateBackgroundDurationMs } from '../utils/backgroundDuration';

const STORAGE_KEY = '@statistics';
const MAX_RECORDS = 5;

export interface BackgroundTaskRecord {
  /** 启动时间（ISO 字符串） */
  startedAt: string;
  /** 统计截止时间（ISO 字符串）；保留该字段以兼容已有持久化数据 */
  lastHeartbeat: string;
  /** 已结算的后台时长 */
  durationMs?: number;
  /** Android 开机后的单调时钟起点；存在时表示该记录仍待结算 */
  backgroundStartElapsedRealtimeMs?: number;
}

export interface StatisticsData {
  /** 后台任务启动记录列表（最新在前，最多 MAX_RECORDS 条） */
  backgroundTaskRecords: BackgroundTaskRecord[];
}

const defaultData: StatisticsData = {
  backgroundTaskRecords: [],
};

interface StatisticsState {
  data: StatisticsData;
  isLoaded: boolean;

  /** 加载持久化数据 */
  load: () => Promise<void>;

  /** 记录后台任务启动（新增一条记录，超过上限自动删除最旧的） */
  recordBackgroundTaskStart: (elapsedRealtimeMs: number) => Promise<void>;

  /** 结算最新一条待完成的后台记录；没有待完成记录时返回 null */
  completeBackgroundTask: (elapsedRealtimeMs: number) => Promise<number | null>;

  /** 获取所有统计信息的文本 */
  getStatisticsText: () => string;
}

async function save(data: StatisticsData): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
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
  const date = new Date(isoString);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export const useStatisticsStore = create<StatisticsState>((set, get) => ({
  data: defaultData,
  isLoaded: false,

  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StatisticsData>;
        set({
          data: {
            ...defaultData,
            ...parsed,
            backgroundTaskRecords: parsed.backgroundTaskRecords ?? [],
          },
          isLoaded: true,
        });
      } else {
        set({ data: defaultData, isLoaded: true });
      }
    } catch {
      set({ data: defaultData, isLoaded: true });
    }
  },

  recordBackgroundTaskStart: async (elapsedRealtimeMs) => {
    if (!get().isLoaded) await get().load();
    const now = new Date().toISOString();
    const newRecord: BackgroundTaskRecord = {
      startedAt: now,
      lastHeartbeat: now,
      durationMs: 0,
      backgroundStartElapsedRealtimeMs: elapsedRealtimeMs,
    };
    const records = [newRecord, ...get().data.backgroundTaskRecords].slice(0, MAX_RECORDS);
    const newData: StatisticsData = { ...get().data, backgroundTaskRecords: records };
    set({ data: newData });
    await save(newData);
  },

  completeBackgroundTask: async (elapsedRealtimeMs) => {
    if (!get().isLoaded) await get().load();
    const records = [...get().data.backgroundTaskRecords];
    const latestRecord = records[0];
    if (latestRecord?.backgroundStartElapsedRealtimeMs === undefined) return null;

    const currentWallClockMs = Date.now();
    const parsedStartWallClockMs = new Date(latestRecord.startedAt).getTime();
    const backgroundStartWallClockMs = Number.isFinite(parsedStartWallClockMs)
      ? parsedStartWallClockMs
      : currentWallClockMs;
    const durationMs = calculateBackgroundDurationMs({
      accumulatedDurationMs: latestRecord.durationMs ?? 0,
      backgroundStartElapsedRealtimeMs: latestRecord.backgroundStartElapsedRealtimeMs,
      currentElapsedRealtimeMs: elapsedRealtimeMs,
      backgroundStartWallClockMs,
      currentWallClockMs,
    });
    const completedRecord = { ...latestRecord };
    delete completedRecord.backgroundStartElapsedRealtimeMs;
    records[0] = {
      ...completedRecord,
      durationMs,
      // Keep rollbacks compatible with the previous lastHeartbeat-based duration calculation.
      lastHeartbeat: new Date(backgroundStartWallClockMs + durationMs).toISOString(),
    };
    const newData: StatisticsData = { ...get().data, backgroundTaskRecords: records };
    set({ data: newData });
    await save(newData);
    return durationMs;
  },

  getStatisticsText: () => {
    const { backgroundTaskRecords } = get().data;
    const lines: string[] = ['=== 统计信息 ===', ''];

    if (backgroundTaskRecords.length === 0) {
      lines.push('后台任务: 无记录');
    } else {
      lines.push(`后台任务记录 (最近 ${backgroundTaskRecords.length} 次):`);
      backgroundTaskRecords.forEach((record, index) => {
        const start = new Date(record.startedAt).getTime();
        const last = new Date(record.lastHeartbeat).getTime();
        const duration = formatDuration(record.durationMs ?? last - start);
        lines.push(`  ${index + 1}. 启动: ${formatTime(record.startedAt)}`);
        lines.push(`     持续: ${duration}`);
      });
    }

    return lines.join('\n');
  },
}));
