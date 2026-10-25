import { getReadyHistorySyncService } from '../services/history/historySyncReadiness';

jest.mock('../services/history/HistorySyncService', () => ({
  getHistorySyncService: () => mockService,
}));
jest.mock('../services/ServiceRuntime', () => ({
  requestServiceRuntime: () => mockRequestRuntime(),
}));
jest.mock('../services/ConfigService', () => ({
  configService: { getConfig: async () => mockConfig },
}));

const mockService = { isInitialized: jest.fn() };
const mockRequestRuntime = jest.fn();
let mockConfig: {
  enableHistorySync: boolean;
  activeServerIndex: number;
  servers: { type: string }[];
};

beforeEach(() => {
  jest.resetAllMocks();
  mockService.isInitialized.mockReturnValue(false);
  mockConfig = {
    enableHistorySync: true,
    activeServerIndex: 0,
    servers: [{ type: 'syncclipboard' }],
  };
});

test('enabled sync waits for runtime startup instead of reporting disabled', async () => {
  let resolve!: () => void;
  mockRequestRuntime.mockReturnValue(
    new Promise<void>((done) => {
      resolve = done;
    })
  );
  let settled = false;
  const waiting = getReadyHistorySyncService().then((service) => {
    settled = true;
    return service;
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(settled).toBe(false);
  expect(mockRequestRuntime).toHaveBeenCalledTimes(1);
  mockService.isInitialized.mockReturnValue(true);
  resolve();
  expect(await waiting).toBe(mockService);
});

test('startup failure is propagated rather than mislabeled as sync disabled', async () => {
  mockRequestRuntime.mockRejectedValue(new Error('migration failed'));
  await expect(getReadyHistorySyncService()).rejects.toThrow('migration failed');
});

test('disabling sync while waiting prevents a late transfer', async () => {
  mockRequestRuntime.mockImplementation(async () => {
    mockConfig.enableHistorySync = false;
    mockService.isInitialized.mockReturnValue(true);
  });
  expect(await getReadyHistorySyncService()).toBeNull();
  expect(mockRequestRuntime).toHaveBeenCalledTimes(1);
});

test('disabled sync does not start the runtime even if an old service is still ready', async () => {
  mockConfig.enableHistorySync = false;
  mockService.isInitialized.mockReturnValue(true);
  expect(await getReadyHistorySyncService()).toBeNull();
  expect(mockRequestRuntime).not.toHaveBeenCalled();
});

test('runtime success without a ready history API remains an initialization error', async () => {
  mockRequestRuntime.mockResolvedValue(undefined);
  await expect(getReadyHistorySyncService()).rejects.toThrow('History API not initialized');
});

test('a ready service is reused without starting another runtime session', async () => {
  mockService.isInitialized.mockReturnValue(true);
  expect(await getReadyHistorySyncService()).toBe(mockService);
  expect(mockRequestRuntime).not.toHaveBeenCalled();
});
