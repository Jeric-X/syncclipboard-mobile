import { DEFAULT_APP_CONFIG, type AppConfig } from '../types/storage';

describe('ClipboardSyncSettingsSource', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('should call loadConfig when isLoaded is false', async () => {
    const loadConfig = jest.fn().mockResolvedValue(undefined);
    const state = {
      isLoaded: false,
      loadConfig,
      getActiveServer: jest.fn(),
      config: null,
    };

    jest.doMock('../stores/settingsStore', () => ({
      useSettingsStore: {
        getState: () => state,
        subscribe: jest.fn(),
      },
    }));

    const {
      createSettingsStoreClipboardSyncSettingsSource,
    } = require('../services/ClipboardSyncSettingsSource');
    const source = createSettingsStoreClipboardSyncSettingsSource();

    await source.ensureLoaded();

    expect(loadConfig).toHaveBeenCalledTimes(1);
  });

  it('should expose active server and config from settings store', () => {
    const server = {
      type: 'syncclipboard' as const,
      name: 'test-server',
      url: 'https://example.com',
    };
    const config: AppConfig = { ...DEFAULT_APP_CONFIG, localPollingInterval: 1500 };
    const state = {
      isLoaded: true,
      loadConfig: jest.fn(),
      getActiveServer: jest.fn(() => server),
      config,
    };

    jest.doMock('../stores/settingsStore', () => ({
      useSettingsStore: {
        getState: () => state,
        subscribe: jest.fn(),
      },
    }));

    const {
      createSettingsStoreClipboardSyncSettingsSource,
    } = require('../services/ClipboardSyncSettingsSource');
    const source = createSettingsStoreClipboardSyncSettingsSource();

    expect(source.getActiveServer()).toEqual(server);
    expect(source.getConfig()).toEqual(config);
  });

  it('subscribeConfig should forward config snapshots and return unsubscribe', () => {
    const unsubscribe = jest.fn();
    type ConfigSubscriber = (
      state: { config: AppConfig | null },
      prevState: { config: AppConfig | null }
    ) => void;
    let listener: ConfigSubscriber | undefined;

    const subscribe = jest.fn((cb) => {
      listener = cb;
      return unsubscribe;
    });

    const state = {
      isLoaded: true,
      loadConfig: jest.fn(),
      getActiveServer: jest.fn(),
      config: { ...DEFAULT_APP_CONFIG, localPollingInterval: 1000 },
    };

    jest.doMock('../stores/settingsStore', () => ({
      useSettingsStore: {
        getState: () => state,
        subscribe,
      },
    }));

    const {
      createSettingsStoreClipboardSyncSettingsSource,
    } = require('../services/ClipboardSyncSettingsSource');
    const source = createSettingsStoreClipboardSyncSettingsSource();
    const handler = jest.fn();

    const unsub = source.subscribeConfig(handler);
    expect(listener).toBeDefined();
    if (!listener) return;

    listener(
      { config: { ...DEFAULT_APP_CONFIG, localPollingInterval: 2000 } },
      { config: { ...DEFAULT_APP_CONFIG, localPollingInterval: 1000 } }
    );

    expect(handler).toHaveBeenCalledWith(
      { ...DEFAULT_APP_CONFIG, localPollingInterval: 2000 },
      { ...DEFAULT_APP_CONFIG, localPollingInterval: 1000 }
    );
    expect(unsub).toBe(unsubscribe);
  });
});
