import initSqlJs, { type Database } from 'sql.js';
import type { HistorySqlConnection } from '../../src/storage/HistoryDatabase';

/** 使用真正的 SQLite SQL/事务语义，避免用 mock 掩盖迁移和回滚错误。 */
export async function createHistorySqlite() {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  return { raw, connection: wrapHistorySqlite(raw) };
}

/** 为 WASM SQLite 提供与生产异步连接一致的窄接口。 */
export function wrapHistorySqlite(raw: Database): HistorySqlConnection {
  const connection: HistorySqlConnection = {
    async execAsync(sql) {
      raw.exec(sql);
    },
    async runAsync(sql, ...params) {
      raw.run(sql, params);
    },
    async getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]> {
      const statement = raw.prepare(sql);
      try {
        statement.bind(params);
        const rows: T[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as T);
        return rows;
      } finally {
        statement.free();
      }
    },
    async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null> {
      return (await connection.getAllAsync<T>(sql, ...params))[0] ?? null;
    },
    async withTransactionAsync(task) {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return connection;
}
