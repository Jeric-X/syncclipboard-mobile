import AsyncStorage from '@react-native-async-storage/async-storage';
import { HistoryDatabase, type HistorySqlConnection } from '../storage/HistoryDatabase';
import { createHistorySqlite } from '../../test/helpers/historySqlite';
import { HistoryStorage } from '../storage/HistoryStorage';
import { createHistoryItem, HistorySyncStatus } from '../types/clipboard';
import { STORAGE_KEYS } from '../types/storage';
import { loadLegacyHistory, readLegacyHistoryChunks } from '../storage/legacyHistory';

let connection: HistorySqlConnection;
const mockValues = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => {
    const value = mockValues.get(key) ?? null;
    if (value && value.length > 2 * 1024 * 1024) {
      throw new Error('Row too big to fit into CursorWindow requiredPos=0, totalRows=1');
    }
    return value;
  }),
  setItem: jest.fn(async (key: string, value: string) => {
    mockValues.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockValues.delete(key);
  }),
}));
jest.mock('../utils/fileStorage', () => ({
  getHistoryFileDir: jest.fn(),
  initFileStorage: jest.fn().mockResolvedValue(undefined),
  HISTORY_BASE_DIR: { exists: false },
}));
jest.mock('../storage/ConfigStorage', () => ({
  configStorage: { getConfig: async () => ({ maxHistoryItems: 0 }) },
}));

function restart() {
  (HistoryStorage as unknown as { instance: null }).instance = null;
  const storage = new HistoryStorage(new HistoryDatabase(async () => connection));
  jest.spyOn(storage, 'cleanupOrphanedData').mockResolvedValue(0);
  jest.spyOn(storage, 'cleanupByCount').mockResolvedValue(0);
  return storage;
}

function item(hash: string, text = hash) {
  return createHistoryItem({
    type: 'Text',
    profileHash: hash,
    text,
    hasData: false,
    timestamp: 100,
    syncStatus: HistorySyncStatus.Synced,
  });
}

beforeEach(async () => {
  connection = (await createHistorySqlite()).connection;
  mockValues.clear();
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('large history including a single large text survives repeated process restarts', async () => {
  const records = Array.from({ length: 2000 }, (_, i) => item(`hash-${i}`, '文'.repeat(1000)));
  records.push(item('large-text', 'x'.repeat(3 * 1024 * 1024)));
  await restart().addItems(records);
  for (let i = 0; i < 2; i++) {
    const storage = restart();
    expect(await storage.getCount()).toBe(records.length);
    expect((await storage.getItem('large-text'))?.text).toBe(records.at(-1)?.text);
    await storage.toggleStar('hash-0');
  }
});

test('readable legacy history migrates with local fields and remains readable after restart', async () => {
  mockValues.set(
    STORAGE_KEYS.HISTORY,
    JSON.stringify([{ ...item('old'), starred: true, pinned: true }])
  );
  mockValues.set(STORAGE_KEYS.HISTORY_VERSION, '1');
  const storage = restart();
  expect(await storage.getItem('old')).toMatchObject({ starred: true, pinned: true });
  await storage.addItem(item('new'));
  expect(await restart().getCount()).toBe(2);
});

test('unrelated read failures reject initialization and cannot overwrite persisted history', async () => {
  const original = JSON.stringify([item('old')]);
  mockValues.set(STORAGE_KEYS.HISTORY, original);
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage unavailable'));
  const storage = restart();
  await expect(storage.addItem(item('new'))).rejects.toThrow('storage unavailable');
  expect(mockValues.get(STORAGE_KEYS.HISTORY)).toBe(original);
  expect(await storage.getCount()).toBe(1);
});

test('clear persists an empty history so a restart does not restore legacy records', async () => {
  mockValues.set(STORAGE_KEYS.HISTORY, JSON.stringify([item('old')]));
  const storage = restart();
  await storage.initialize();
  await storage.clear();
  expect(await restart().getCount()).toBe(0);
});

test('oversized legacy history migrates all types, local metadata and deleted records without AsyncStorage.getItem', async () => {
  await connection.execAsync(
    'CREATE TABLE catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT)'
  );
  const original = [
    { ...item('text', '中😀'.repeat(800000)), starred: true, pinned: true },
    { ...item('image'), type: 'Image', hasData: true, fileUri: 'file://history/image.png' },
    { ...item('file'), type: 'File', isDeleted: true, version: 42 },
    { ...item('group'), type: 'Group', syncStatus: HistorySyncStatus.NeedSync },
  ];
  await connection.runAsync(
    'INSERT INTO catalystLocalStorage VALUES (?, ?)',
    STORAGE_KEYS.HISTORY,
    JSON.stringify(original)
  );
  await connection.runAsync(
    'INSERT INTO catalystLocalStorage VALUES (?, ?)',
    STORAGE_KEYS.HISTORY_VERSION,
    '1'
  );
  const database = new HistoryDatabase(
    async () => connection,
    () => loadLegacyHistory(() => readLegacyHistoryChunks(connection))
  );
  const storage = new HistoryStorage(database);
  jest.spyOn(storage, 'cleanupOrphanedData').mockResolvedValue(0);
  expect(await storage.getAllItemsIncludingDeleted()).toEqual(
    expect.arrayContaining(original.map((value) => expect.objectContaining(value)))
  );
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  expect(await restart().getAllItemsIncludingDeleted()).toHaveLength(4);
  expect(await storage.getLastSyncTime()).toBeNull();
});

test('concurrent initialization and a new clipboard item share one migration', async () => {
  let resolve!: (value: { json: string; version: number }) => void;
  const pending = new Promise<{ json: string; version: number }>((done) => {
    resolve = done;
  });
  const read = jest.fn(() => pending);
  const storage = new HistoryStorage(
    new HistoryDatabase(
      async () => connection,
      () => loadLegacyHistory(read)
    )
  );
  const cleanup = jest.spyOn(storage, 'cleanupOrphanedData').mockResolvedValue(0);
  jest.spyOn(storage, 'cleanupByCount').mockResolvedValue(0);
  const operations = [storage.initialize(), storage.initialize(), storage.addItem(item('new'))];
  resolve({ json: JSON.stringify([item('old')]), version: 0 });
  await Promise.all(operations);
  expect(read).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(await restart().getCount()).toBe(2);
});

test.each(['{invalid', '{}', '[{}]'])(
  'invalid legacy data %s is preserved and never cleaned or overwritten',
  async (json) => {
    mockValues.set(STORAGE_KEYS.HISTORY, json);
    const storage = restart();
    await expect(storage.clear()).rejects.toThrow();
    await expect(storage.addItem(item('new'))).rejects.toThrow();
    expect(storage.cleanupOrphanedData).not.toHaveBeenCalled();
    expect(mockValues.get(STORAGE_KEYS.HISTORY)).toBe(json);
  }
);

test('version zero migration preserves timestamp as lastAccessed and is not repeated', async () => {
  const legacy = { ...item('old'), lastAccessed: undefined, syncStatus: undefined };
  mockValues.set(STORAGE_KEYS.HISTORY, JSON.stringify([legacy]));
  expect(await restart().getItem('old')).toMatchObject({
    lastAccessed: 100,
    syncStatus: HistorySyncStatus.LocalOnly,
  });
  mockValues.set(STORAGE_KEYS.HISTORY, 'corrupted after migration');
  expect(await restart().getCount()).toBe(1);
});

test.each(['-1', '0.5', '2', 'invalid'])(
  'unsupported legacy version %s blocks migration and permits retry after repair',
  async (version) => {
    const original = JSON.stringify([item('old')]);
    mockValues.set(STORAGE_KEYS.HISTORY, original);
    mockValues.set(STORAGE_KEYS.HISTORY_VERSION, version);
    const storage = restart();
    await expect(storage.addItem(item('new'))).rejects.toThrow(
      'Unsupported legacy history version'
    );
    expect(storage.cleanupOrphanedData).not.toHaveBeenCalled();
    expect(await connection.getAllAsync('SELECT * FROM history_meta')).toEqual([]);
    expect(await connection.getAllAsync('SELECT * FROM history_records')).toEqual([]);
    expect(mockValues.get(STORAGE_KEYS.HISTORY)).toBe(original);
    mockValues.set(STORAGE_KEYS.HISTORY_VERSION, '1');
    expect(await storage.getCount()).toBe(1);
    expect(await restart().getItem('old')).toMatchObject({ profileHash: 'old', timestamp: 100 });
  }
);
