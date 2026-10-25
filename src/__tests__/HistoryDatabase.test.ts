import { HistoryDatabase } from '../storage/HistoryDatabase';
import { readLegacyHistoryChunks } from '../storage/legacyHistory';
import { createHistorySqlite } from '../../test/helpers/historySqlite';
import { createHistoryItem } from '../types/clipboard';
import { STORAGE_KEYS } from '../types/storage';

const item = (hash: string, text = hash) =>
  createHistoryItem({
    profileHash: hash,
    type: 'Text',
    text,
    hasData: false,
    timestamp: 100,
    lastModified: 100,
    lastAccessed: 100,
  });

test('legacy chunks reconstruct multi-megabyte Unicode JSON including emoji without changing the old value', async () => {
  const { raw, connection } = await createHistorySqlite();
  raw.exec('CREATE TABLE catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT)');
  const original = JSON.stringify([item('large', '中😀a'.repeat(700000))]);
  raw.run('INSERT INTO catalystLocalStorage VALUES (?, ?)', [STORAGE_KEYS.HISTORY, original]);
  raw.run('INSERT INTO catalystLocalStorage VALUES (?, ?)', [STORAGE_KEYS.HISTORY_VERSION, '1']);
  const query = jest.spyOn(connection, 'getFirstAsync');
  const result = await readLegacyHistoryChunks(connection);
  expect(result).toEqual({ json: original, version: 1 });
  expect(query.mock.calls.filter(([sql]) => sql.includes('substr')).length).toBeGreaterThan(10);
  expect(
    raw.exec('SELECT value FROM catalystLocalStorage WHERE key = "@syncclipboard:history"')[0]
      .values[0][0]
  ).toBe(original);
  raw.close();
});

test('interrupted migration rolls back rows and completion marker, then retries without duplicates', async () => {
  const { connection } = await createHistorySqlite();
  const legacy = jest.fn(async () => [item('a'), item('b')]);
  const store = new HistoryDatabase(async () => connection, legacy);
  const run = connection.runAsync.bind(connection);
  const failure = jest
    .spyOn(connection, 'runAsync')
    .mockImplementationOnce(run)
    .mockRejectedValueOnce(new Error('disk full'));
  await expect(store.load()).rejects.toThrow('disk full');
  expect(await connection.getAllAsync('SELECT * FROM history_records')).toEqual([]);
  expect(await connection.getAllAsync('SELECT * FROM history_meta')).toEqual([]);
  failure.mockRestore();
  expect(await store.load()).toHaveLength(2);
  expect(legacy).toHaveBeenCalledTimes(2);
  await store.save([item('a')], 123);
  const restarted = new HistoryDatabase(async () => connection, legacy);
  expect(await restarted.load()).toHaveLength(1);
  expect(await restarted.getLastSyncTime()).toBe(123);
  expect(legacy).toHaveBeenCalledTimes(2);
});

test('history changes and cursor roll back together if cursor persistence fails', async () => {
  const { connection } = await createHistorySqlite();
  const store = new HistoryDatabase(
    async () => connection,
    async () => []
  );
  await store.load();
  await store.save([item('a')], 100);
  const run = connection.runAsync.bind(connection);
  const failure = jest.spyOn(connection, 'runAsync').mockImplementation(async (sql, ...params) => {
    if (sql.includes('last_sync_time')) throw new Error('disk full');
    return run(sql, ...params);
  });
  await expect(store.save([item('b')], 200)).rejects.toThrow('disk full');
  failure.mockRestore();
  expect(await store.getLastSyncTime()).toBe(100);
  expect(await store.load()).toEqual([item('a')]);
  await store.save([item('b')], 200);
  expect(await store.getLastSyncTime()).toBe(200);
});

test('queued snapshots commit in order and unchanged records are not rewritten', async () => {
  const { connection } = await createHistorySqlite();
  const store = new HistoryDatabase(
    async () => connection,
    async () => []
  );
  await store.load();
  const first = item('a');
  await store.save([first]);
  const run = jest.spyOn(connection, 'runAsync');
  const second = item('b');
  await Promise.all([
    store.save([first, second]),
    store.save([{ ...first, starred: true }, second], 200),
  ]);
  const writes = run.mock.calls.filter(([sql]) => sql.includes('INTO history_records'));
  expect(writes.map(([, hash]) => hash)).toEqual(['b', 'a']);
  expect(await store.getLastSyncTime()).toBe(200);
  expect(await store.load()).toEqual(expect.arrayContaining([{ ...first, starred: true }, second]));
});
