import type { HeadlessLifetimeRecord } from '../../stores/statisticsStore';

interface StatisticsSnapshot {
  revision: number;
  headlessLifetimeRecords: HeadlessLifetimeRecord[];
}

function isRecord(value: unknown): value is HeadlessLifetimeRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<HeadlessLifetimeRecord>;
  return (
    typeof record.startedAt === 'string' &&
    typeof record.lastHeartbeat === 'string' &&
    Number.isFinite(Date.parse(record.startedAt)) &&
    Number.isFinite(Date.parse(record.lastHeartbeat))
  );
}

/** 读取当前统计快照，过滤损坏数据。 */
export function readStatisticsSnapshot(raw: string | null, limit: number): StatisticsSnapshot {
  const empty = { revision: 0, headlessLifetimeRecords: [] };
  if (!raw) return empty;
  try {
    const data = JSON.parse(raw);
    if (
      !Number.isSafeInteger(data.revision) ||
      data.revision <= 0 ||
      !Array.isArray(data.headlessLifetimeRecords)
    )
      return empty;
    return {
      revision: data.revision,
      headlessLifetimeRecords: data.headlessLifetimeRecords
        .filter(isRecord)
        .slice(0, limit)
        .map((record: HeadlessLifetimeRecord) => ({
          startedAt: record.startedAt,
          lastHeartbeat: record.lastHeartbeat,
        })),
    };
  } catch {
    return empty;
  }
}

/** 心跳仅覆盖对应版本的活动记录；清除或新会话后，旧心跳自动失效。 */
export function mergeStatisticsHeartbeat(
  snapshot: StatisticsSnapshot,
  raw: string | null
): HeadlessLifetimeRecord[] {
  const records = snapshot.headlessLifetimeRecords;
  if (!raw || snapshot.revision === 0) return records;
  try {
    const heartbeat = JSON.parse(raw);
    if (heartbeat.revision !== snapshot.revision || !isRecord(heartbeat.record)) return records;
    if (records.length && records[0].startedAt !== heartbeat.record.startedAt) return records;
    return [heartbeat.record, ...records.slice(1)];
  } catch {
    return records;
  }
}
