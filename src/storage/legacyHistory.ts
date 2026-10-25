import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { openDatabaseAsync } from 'expo-sqlite';
import { getLegacyHistoryDatabasePath } from 'native-util';
import { HistoryItem, HistorySyncStatus } from '../types/clipboard';
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

/**
 * 旧版 AsyncStorage 历史数据的最终版本号，与新 SQLite schema 版本无关
 */
const CURRENT_LEGACY_HISTORY_VERSION = 1;

/**
 * 迁移函数类型
 */
type MigrationFunction = (items: HistoryItem[]) => HistoryItem[];

/**
 * 版本迁移函数映射
 * key: 目标版本号
 * value: 从上一版本迁移到目标版本的函数
 */
const MIGRATIONS: Record<number, MigrationFunction> = {
  // v0 -> v1: 添加 syncStatus, lastAccessed 字段
  1: (items: HistoryItem[]): HistoryItem[] => {
    return items.map((item) => {
      const migratedItem = { ...item };

      // 设置同步状态默认值
      if (migratedItem.syncStatus === undefined) {
        migratedItem.syncStatus = HistorySyncStatus.LocalOnly;
      }

      // 设置 lastAccessed 默认值
      if (migratedItem.lastAccessed === undefined) {
        migratedItem.lastAccessed = migratedItem.timestamp;
      }

      return migratedItem;
    });
  },
};

/**
 * 将旧版记录补全为新版 HistoryItem
 */
function normalizeLegacyHistoryItem(item: HistoryItem): HistoryItem {
  return {
    type: item.type,
    text: item.text ?? '',
    profileHash: item.profileHash,
    hasData: item.hasData,
    dataName: item.dataName,
    size: item.size ?? 0,
    timestamp: item.timestamp ?? Date.now(),
    deviceName: item.deviceName,
    synced: item.synced,
    starred: item.starred ?? false,
    useCount: item.useCount ?? 0,
    localClipboardHash: item.localClipboardHash,
    fileUri: item.fileUri,
    syncStatus: item.syncStatus ?? HistorySyncStatus.LocalOnly,
    version: item.version ?? 0,
    lastModified: item.lastModified ?? Date.now(),
    lastAccessed: item.lastAccessed ?? Date.now(),
    isDeleted: item.isDeleted ?? false,
    pinned: item.pinned ?? false,
    from: item.from,
  };
}

/** 旧版兼容入口：读取、校验和升级全部封装在此，只向新存储提供 HistoryItem。 */
export async function loadLegacyHistory(
  read: () => Promise<LegacyHistory> = readLegacyHistory
): Promise<HistoryItem[]> {
  const { json, version } = await read();
  if (!Number.isInteger(version) || version < 0 || version > CURRENT_LEGACY_HISTORY_VERSION) {
    throw new Error('Unsupported legacy history version');
  }
  const parsed: unknown = json === null ? [] : JSON.parse(json);
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) =>
        !item ||
        typeof item.profileHash !== 'string' ||
        !item.profileHash ||
        !['Text', 'Image', 'File', 'Group'].includes(item.type)
    )
  )
    throw new Error('Invalid legacy history');
  let items: HistoryItem[] = parsed;
  for (let target = version + 1; target <= CURRENT_LEGACY_HISTORY_VERSION; target++) {
    const migrate = MIGRATIONS[target];
    if (migrate) items = migrate(items);
  }
  return items.map(normalizeLegacyHistoryItem);
}
