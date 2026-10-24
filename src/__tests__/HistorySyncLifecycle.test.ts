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
jest.mock('../storage/SyncStateStorage', () => ({
  getHistoryLastSyncTime: jest.fn(),
  setHistoryLastSyncTime: jest.fn(),
  removeHistoryLastSyncTime: jest.fn(),
}));
jest.mock('../storage/ConfigStorage', () => ({
  configStorage: { getConfig: () => mockGetConfig() },
}));
jest.mock('../services/ConfigService', () => ({
  configService: {
    getActiveServer: () => mockServer,
    getConfig: () => ({ enableHistorySync: true }),
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

const mockStorage = {
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
  mockServer = { type: 'syncclipboard', url: 'https://first.test' };
  mockGetConfig.mockResolvedValue({ enableHistorySync: true });
  mockAPI.queryRecords.mockResolvedValue([]);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
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
