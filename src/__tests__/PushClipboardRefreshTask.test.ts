jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('../services/ConfigService', () => ({
  configService: { getConfig: jest.fn(), getActiveServer: jest.fn() },
}));
jest.mock('../services/sync/ClipboardChangedHandler', () => ({
  getClipboardChangedHandler: jest.fn(() => ({
    processRemoteClipboardContent: jest.fn(),
  })),
}));
jest.mock('../services/sync/RemoteClipboardMonitor', () => ({
  remoteClipboardMonitor: { fetchLatest: jest.fn() },
}));
jest.mock('../utils/Logger', () => ({ initLogger: jest.fn() }));

import type { ClipboardContent } from '../types/clipboard';
import type { AppConfig } from '../types/storage';
import {
  runPushClipboardRefresh,
  type PushClipboardRefreshDependencies,
} from '../tasks/PushClipboardRefreshTask';

describe('PushClipboardRefreshTask', () => {
  const content: ClipboardContent = {
    type: 'Text',
    text: 'authoritative value',
    profileHash: 'remote-hash',
    hasData: false,
  };

  function createDependencies(
    config: Partial<AppConfig> = {
      enableBackgroundTasks: true,
      enableBackgroundDownload: true,
    }
  ): jest.Mocked<PushClipboardRefreshDependencies> {
    return {
      loadConfig: jest.fn().mockResolvedValue(config as AppConfig),
      getActiveServer: jest.fn().mockResolvedValue({
        type: 'syncclipboard',
        url: 'https://sync.example',
      }),
      fetchLatest: jest.fn().mockResolvedValue(content),
      processRemote: jest.fn().mockResolvedValue(undefined),
      initializeLogging: jest.fn(),
    };
  }

  it('fetches authoritative state and applies existing remote clipboard logic', async () => {
    const deps = createDependencies();

    await runPushClipboardRefresh({ hash: 'hint-only-hash' }, deps);

    expect(deps.fetchLatest).toHaveBeenCalledTimes(1);
    expect(deps.processRemote).toHaveBeenCalledWith(content);
  });

  it('does nothing when background download is disabled', async () => {
    const deps = createDependencies({
      enableBackgroundTasks: true,
      enableBackgroundDownload: false,
    });

    await runPushClipboardRefresh({ hash: 'hint-only-hash' }, deps);

    expect(deps.fetchLatest).not.toHaveBeenCalled();
    expect(deps.processRemote).not.toHaveBeenCalled();
  });

  it('rejects malformed payloads without fetching clipboard state', async () => {
    const deps = createDependencies();

    await runPushClipboardRefresh({}, deps);

    expect(deps.fetchLatest).not.toHaveBeenCalled();
  });
});
