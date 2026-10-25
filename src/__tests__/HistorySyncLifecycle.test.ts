import { getReadyHistorySyncService } from '../services/history/historySyncReadiness';
import { historySyncTask } from '../longRunningTask/HistorySyncTask';
import {
  getHistorySyncService,
  resetHistorySyncService,
} from '../services/history/HistorySyncService';
import { LongRunningTaskCoordinator } from '../longRunningTask/LongRunningTaskCoordinator';
import type { ServerConfig } from '../types/api';

jest.mock('../storage/HistoryStorage', () => ({
  HistoryStorage: { getInstance: () => mockStorage },
}));
jest.mock('../utils/clipboard/convert', () => ({ dtoToHistoryItem: jest.fn() }));
jest.mock('../services/history/HistoryService', () => ({
  historyService: { addChangeCallback: jest.fn(), removeChangeCallback: jest.fn() },
}));
jest.mock('../storage/ConfigStorage', () => ({
  configStorage: { getConfig: () => mockGetConfig() },
}));
jest.mock('../services/ConfigService', () => ({
  configService: {
    getActiveServer: () => mockServer,
    getConfig: () => ({ enableHistorySync: true, servers: [mockServer], activeServerIndex: 0 }),
  },
}));
jest.mock('../api/history/HistoryAPIFactory', () => ({ createHistoryAPI: () => mockAPI }));
jest.mock('../services/history/HistoryTransferQueue', () => ({
  getHistoryTransferQueue: () => mockQueue,
}));
jest.mock('signalr-client', () => ({
  getSignalRClient: () => ({
    onRemoteHistoryChanged: jest.fn(),
    offRemoteHistoryChanged: jest.fn(),
  }),
}));

jest.mock('../services/ServiceRuntime', () => ({ requestServiceRuntime: async () => {} }));
jest.mock('../longRunningTask/LongRunningTaskManager', () => ({
  longRunningTaskManager: { refresh: (...args: unknown[]) => mockRefresh(...args) },
}));
const mockRefresh = jest.fn();

const mockStorage = {
  getLastSyncTime: jest.fn().mockResolvedValue(null),
  setLastSyncTime: jest.fn().mockResolvedValue(undefined),
  getAllItemsIncludingDeleted: jest.fn().mockResolvedValue([]),
  getNeedSyncItems: jest.fn().mockResolvedValue([]),
  getLocalOnlyItems: jest.fn().mockResolvedValue([]),
  cleanupExpiredSoftDeletes: jest.fn().mockResolvedValue(0),
};
const mockQueue = { start: jest.fn(), stop: jest.fn(), setHistoryAPI: jest.fn() };
const mockGetConfig = jest.fn();
const mockAPI = { queryRecords: jest.fn() };
let mockServer: ServerConfig;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.getLastSyncTime.mockResolvedValue(null);
  mockStorage.setLastSyncTime.mockResolvedValue(undefined);
  mockServer = { type: 'syncclipboard', url: 'https://first.test' };
  mockGetConfig.mockResolvedValue({ enableHistorySync: true });
  mockAPI.queryRecords.mockResolvedValue([]);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

test('incremental sync waits for migrated storage and ignores a cursor reset since service initialization', async () => {
  mockStorage.getLastSyncTime.mockResolvedValue(100);
  await historySyncTask.start();
  const migration = deferred<number | null>();
  mockStorage.getLastSyncTime.mockReturnValueOnce(migration.promise);
  const syncing = getHistorySyncService().syncIncremental();
  await flush();
  expect(mockAPI.queryRecords).not.toHaveBeenCalled();
  migration.resolve(null);
  await syncing;
  expect(mockAPI.queryRecords.mock.calls[0][0]).not.toHaveProperty('modifiedAfter');
});

test('a failed final history/cursor commit fails sync and retains the previous cursor', async () => {
  mockStorage.getLastSyncTime.mockResolvedValue(100);
  await historySyncTask.start();
  mockStorage.setLastSyncTime.mockRejectedValueOnce(new Error('disk full'));
  await expect(getHistorySyncService().syncIncremental()).rejects.toThrow('disk full');
  expect(getHistorySyncService().getLastSyncTime()).toBe(100);
});

test('failed history migration leaves sync uninitialized and a retry starts the transfer queue', async () => {
  const service = getHistorySyncService();
  mockStorage.getLastSyncTime.mockRejectedValueOnce(new Error('migration failed'));
  await expect(service.ensureInitialized(mockServer)).rejects.toThrow('migration failed');
  expect(service.isInitialized()).toBe(false);
  expect(mockQueue.start).not.toHaveBeenCalled();
  await expect(service.ensureInitialized(mockServer)).resolves.toBe(true);
  expect(mockQueue.start).toHaveBeenCalledTimes(1);
  expect(service.isInitialized()).toBe(true);
});

test('destroy during migration prevents late initialization from restarting the transfer queue', async () => {
  const service = getHistorySyncService();
  const migration = deferred<number | null>();
  mockStorage.getLastSyncTime.mockReturnValueOnce(migration.promise);
  const initializing = service.ensureInitialized(mockServer);
  await flush();
  await service.destroy();
  migration.resolve(null);
  await initializing;
  expect(service.isInitialized()).toBe(false);
  expect(mockQueue.start).not.toHaveBeenCalled();
});
afterEach(async () => {
  await historySyncTask.stop();
  resetHistorySyncService();
  jest.restoreAllMocks();
});

test('configuration refresh returns while history network sync is pending, allowing stopAll to cancel it', async () => {
  const coordinator = new LongRunningTaskCoordinator(
    async () => ({ foreground: true, backgroundEnabled: true }),
    jest.fn()
  );
  coordinator.register(historySyncTask, true);
  await coordinator.startAll();
  const network = deferred<[]>();
  let signal!: AbortSignal;
  mockAPI.queryRecords.mockImplementationOnce((_options, value: AbortSignal) => {
    signal = value;
    return network.promise;
  });
  mockServer = { ...mockServer, url: 'https://second.test' };
  let refreshed = false;
  const refresh = coordinator.refresh(true).then(() => {
    refreshed = true;
  });
  await flush();
  expect(signal).toBeDefined();
  const stopped = coordinator.stopAll();
  await flush();
  try {
    expect(refreshed).toBe(true);
    expect(historySyncTask.isRunning()).toBe(false);
    expect(signal.aborted).toBe(true);
  } finally {
    network.reject(new DOMException('Aborted', 'AbortError'));
    await refresh;
    await stopped;
    await flush();
  }
});

test('stopping during the async sync-enabled check prevents any later network request', async () => {
  await historySyncTask.start();
  const config = deferred<{ enableHistorySync: boolean }>();
  mockGetConfig.mockReturnValueOnce(config.promise);
  const syncing = getHistorySyncService().syncAll();
  await historySyncTask.stop();
  config.resolve({ enableHistorySync: true });
  await syncing;
  expect(mockAPI.queryRecords).not.toHaveBeenCalled();
});

test('background switch sync failures are reported without rejecting configuration refresh', async () => {
  await historySyncTask.start();
  const error = new Error('offline');
  mockAPI.queryRecords.mockRejectedValueOnce(error);
  mockServer = { ...mockServer, url: 'https://second.test' };
  await expect(historySyncTask.onConfigChanged()).resolves.toBeUndefined();
  await flush();
  expect(console.error).toHaveBeenCalledWith('[HistorySyncService] Sync failed:', error);
});

test('rapid server changes cancel the old request and sync only the latest server after it exits', async () => {
  await historySyncTask.start();
  const network = deferred<[]>();
  let signal!: AbortSignal;
  mockAPI.queryRecords.mockImplementationOnce((_options, value: AbortSignal) => {
    signal = value;
    return network.promise;
  });
  mockServer = { ...mockServer, url: 'https://second.test' };
  await historySyncTask.onConfigChanged();
  await flush();
  mockServer = { ...mockServer, url: 'https://third.test' };
  await historySyncTask.onConfigChanged();
  mockServer = { ...mockServer, url: 'https://fourth.test' };
  await historySyncTask.onConfigChanged();
  expect(signal.aborted).toBe(true);
  expect(mockAPI.queryRecords).toHaveBeenCalledTimes(1);
  network.resolve([]);
  await flush();
  expect(mockAPI.queryRecords).toHaveBeenCalledTimes(2);
  expect(mockQueue.setHistoryAPI).toHaveBeenCalledTimes(4);
  expect(mockStorage.cleanupExpiredSoftDeletes).toHaveBeenCalledTimes(1);
});

test('stop discards a pending replacement sync and ignores a late response from the old request', async () => {
  await historySyncTask.start();
  const network = deferred<[]>();
  mockAPI.queryRecords.mockReturnValueOnce(network.promise);
  const syncing = getHistorySyncService().syncAll();
  await flush();
  mockServer = { ...mockServer, url: 'https://second.test' };
  await historySyncTask.onConfigChanged();
  await historySyncTask.stop();
  network.resolve([]);
  await syncing;
  await flush();
  expect(mockAPI.queryRecords).toHaveBeenCalledTimes(1);
  expect(mockStorage.getAllItemsIncludingDeleted).not.toHaveBeenCalled();
  expect(mockStorage.cleanupExpiredSoftDeletes).not.toHaveBeenCalled();
});

test('history-page retry recovers sync through the coordinator after storage startup failed', async () => {
  const coordinator = new LongRunningTaskCoordinator(
    async () => ({ foreground: true, backgroundEnabled: true }),
    jest.fn()
  );
  coordinator.register(historySyncTask, true);
  mockRefresh.mockImplementation((changed: boolean) => coordinator.refresh(changed));
  mockStorage.getLastSyncTime.mockRejectedValueOnce(new Error('temporary storage failure'));
  await coordinator.startAll();
  expect(getHistorySyncService().isInitialized()).toBe(false);
  expect(mockQueue.start).not.toHaveBeenCalled();
  await expect(getReadyHistorySyncService()).resolves.toBe(getHistorySyncService());
  expect(mockRefresh).toHaveBeenCalledWith(true);
  expect(mockQueue.start).toHaveBeenCalledTimes(1);
  await coordinator.stopAll();
});
