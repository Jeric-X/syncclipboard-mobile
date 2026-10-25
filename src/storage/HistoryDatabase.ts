import { openDatabaseAsync } from 'expo-sqlite';
import type { HistoryItem } from '../types/clipboard';
import { loadLegacyHistory } from './legacyHistory';

/** 历史存储需要的 SQL 接口，测试可注入真实 SQLite 引擎。 */
export interface HistorySqlConnection {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/** 独占连接并串行访问；每条历史单独存储，只写入变化的记录。 */
export class HistoryDatabase {
  private connection: HistorySqlConnection | null = null;
  private operations: Promise<unknown> = Promise.resolve();
  private persisted = new Map<string, string>();

  constructor(
    private open: () => Promise<HistorySqlConnection> = () =>
      openDatabaseAsync('history.db', { useNewConnection: true }),
    private readInitialItems: () => Promise<HistoryItem[]> = loadLegacyHistory
  ) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.operations.then(task);
    this.operations = result.catch(() => {});
    return result;
  }

  /** 迁移数据与完成标记一起提交；失败不会留下半份新历史。 */
  load(): Promise<HistoryItem[]> {
    return this.enqueue(async () => {
      const db = this.connection ?? (this.connection = await this.open());
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS history_records (profile_hash TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS history_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      `);
      const migrated = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM history_meta WHERE key = 'schema_version'"
      );
      if (migrated && migrated.value !== '1')
        throw new Error('Unsupported history database version');
      if (!migrated) {
        const items = await this.readInitialItems();
        await db.withTransactionAsync(async () => {
          for (const item of items) {
            await db.runAsync(
              'INSERT INTO history_records (profile_hash, payload) VALUES (?, ?)',
              item.profileHash.toLowerCase(),
              JSON.stringify(item)
            );
          }
          // 首次迁移后重新全量拉取，补回旧版读失败后可能已被覆盖的服务器历史。
          await db.runAsync("INSERT INTO history_meta (key, value) VALUES ('schema_version', '1')");
        });
      }
      const rows = await db.getAllAsync<{ profile_hash: string; payload: string }>(
        'SELECT profile_hash, payload FROM history_records'
      );
      const items = rows.map((row) => JSON.parse(row.payload) as HistoryItem);
      this.persisted = new Map(rows.map((row) => [row.profile_hash, row.payload]));
      return items;
    });
  }

  /** 最终历史快照和同步游标同事务提交，失败时继续沿用旧游标。 */
  save(items: HistoryItem[], lastSyncTime?: number | null): Promise<void> {
    // 在排队前固定快照，避免后续内存修改改变本次写入内容。
    const snapshot = new Map(
      items.map((item) => [item.profileHash.toLowerCase(), JSON.stringify(item)])
    );
    return this.enqueue(async () => {
      const db = this.requireConnection();
      await db.withTransactionAsync(async () => {
        for (const [hash, payload] of snapshot) {
          if (this.persisted.get(hash) === payload) continue;
          await db.runAsync(
            'INSERT OR REPLACE INTO history_records (profile_hash, payload) VALUES (?, ?)',
            hash,
            payload
          );
        }
        for (const hash of this.persisted.keys()) {
          if (!snapshot.has(hash))
            await db.runAsync('DELETE FROM history_records WHERE profile_hash = ?', hash);
        }
        if (lastSyncTime === null) {
          await db.runAsync("DELETE FROM history_meta WHERE key = 'last_sync_time'");
        } else if (lastSyncTime !== undefined) {
          await db.runAsync(
            "INSERT OR REPLACE INTO history_meta (key, value) VALUES ('last_sync_time', ?)",
            String(lastSyncTime)
          );
        }
      });
      this.persisted = snapshot;
    });
  }

  /** 游标读取也经过队列，不能越过尚未提交的数据。 */
  getLastSyncTime(): Promise<number | null> {
    return this.enqueue(async () => {
      const row = await this.requireConnection().getFirstAsync<{ value: string }>(
        "SELECT value FROM history_meta WHERE key = 'last_sync_time'"
      );
      return row && Number.isFinite(Number(row.value)) ? Number(row.value) : null;
    });
  }

  private requireConnection(): HistorySqlConnection {
    if (!this.connection) throw new Error('History database is not initialized');
    return this.connection;
  }
}
