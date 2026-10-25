import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { openDatabaseAsync } from 'expo-sqlite';
import { getLegacyHistoryDatabasePath } from 'native-util';
import { STORAGE_KEYS } from '../types/storage';

export interface LegacyHistory {
  json: string | null;
  version: number;
}

interface LegacyReader {
  getFirstAsync<T>(sql: string, ...params: (string | number)[]): Promise<T | null>;
}

/** 在数据库内截取片段，避免把旧版整段 JSON 放进 Android CursorWindow。 */
export async function readLegacyHistoryChunks(db: LegacyReader): Promise<LegacyHistory> {
  const row = await db.getFirstAsync<{ length: number }>(
    'SELECT length(value) AS length FROM catalystLocalStorage WHERE key = ?',
    STORAGE_KEYS.HISTORY
  );
  const chunks: string[] = [];
  const chunkSize = 64 * 1024;
  for (let offset = 1; row && offset <= row.length; offset += chunkSize) {
    const part = await db.getFirstAsync<{ chunk: string }>(
      'SELECT substr(value, ?, ?) AS chunk FROM catalystLocalStorage WHERE key = ?',
      offset,
      chunkSize,
      STORAGE_KEYS.HISTORY
    );
    if (!part || !part.chunk) throw new Error('Incomplete legacy history');
    chunks.push(part.chunk);
  }
  const version = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM catalystLocalStorage WHERE key = ?',
    STORAGE_KEYS.HISTORY_VERSION
  );
  return { json: row ? chunks.join('') : null, version: Number(version?.value ?? 0) };
}

/** Android 只读访问旧库；其他平台沿用 AsyncStorage，旧值始终保留。 */
export async function readLegacyHistory(): Promise<LegacyHistory> {
  const path = getLegacyHistoryDatabasePath();
  if (!path) {
    return {
      json: await AsyncStorage.getItem(STORAGE_KEYS.HISTORY),
      version: Number((await AsyncStorage.getItem(STORAGE_KEYS.HISTORY_VERSION)) ?? 0),
    };
  }
  const file = new File(path);
  const db = await openDatabaseAsync(
    file.name,
    { useNewConnection: true },
    file.parentDirectory.uri
  );
  try {
    await db.execAsync('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;');
    let result!: LegacyHistory;
    // 独立连接上的只读事务保证各片段来自同一快照。
    await db.withTransactionAsync(async () => {
      result = await readLegacyHistoryChunks(db);
    });
    return result;
  } finally {
    await db.closeAsync();
  }
}
