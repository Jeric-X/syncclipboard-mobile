import { AppState } from 'react-native';
import { configService } from '../services/ConfigService';
import { clipboardMonitor } from '../services/clipboard/ClipboardMonitor';
import { remoteClipboardMonitor } from '../services/sync/RemoteClipboardMonitor';
import { clipboardSyncState } from '../services/sync/SyncState';
import { getClipboardSyncService } from '../services/sync/ClipboardSyncService';
import {
  clearJustUploadedHash,
  getJustUploadedHash,
  setJustUploadedHash,
} from '../services/sync/JustSetHash';
import { DEFAULT_APP_CONFIG } from '../types/storage';

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('../services/ConfigService', () => ({ configService: { getConfig: jest.fn() } }));
function mockMonitor() {
  return {
    addBackgroundRunningChecker: jest.fn(),
    removeBackgroundRunningChecker: jest.fn(),
    addCallback: jest.fn(),
    removeCallback: jest.fn(),
    reset: jest.fn(),
    setLastContentHash: jest.fn(),
  };
}
jest.mock('../services/clipboard/ClipboardMonitor', () => ({ clipboardMonitor: mockMonitor() }));
jest.mock('../services/sync/RemoteClipboardMonitor', () => ({
  remoteClipboardMonitor: mockMonitor(),
}));
jest.mock('../services/clipboard/LocalClipboard', () => ({
  localClipboard: { registerRemoteCopiedCallback: jest.fn() },
}));
jest.mock('../services/sync/SyncState', () => ({
  clipboardSyncState: {
    clearUploadState: jest.fn(),
    clearDownloadState: jest.fn(),
    setRemoteContent: jest.fn(),
  },
}));
jest.mock('../services/history/HistoryService', () => ({
  historyService: { addChangeCallback: jest.fn(), removeChangeCallback: jest.fn() },
}));
jest.mock('../services/history/HistoryTransferQueue', () => ({
  getHistoryTransferQueue: () => ({
    onTaskStatusChanged: jest.fn(),
    offTaskStatusChanged: jest.fn(),
  }),
}));
jest.mock('../services/sync/historyChangedHandler', () => ({
  createHistoryChangedHandler: jest.fn(),
}));
jest.mock('../services/sync/historyTransferQueueChangedHandler', () => ({
  createTransferQueueChangedHandler: jest.fn(),
}));
const mockHandler = {
  handleAutoUpload: jest.fn(),
  processRemoteClipboardContent: jest.fn(),
  resetLastLocalProfileHash: jest.fn(),
  resetLastRemoteProfileHash: jest.fn(),
};
let mockReadConfig: () => ReturnType<typeof configService.getConfig>;
jest.mock('../services/sync/ClipboardChangedHandler', () => ({
  ClipboardChangedHandler: jest.fn((getConfig) => {
    mockReadConfig = getConfig;
    return mockHandler;
  }),
}));

it.each(['local', 'remote'])(
  'keeps an in-flight %s transfer and its progress when monitoring pauses',
  async (side) => {
    jest.clearAllMocks();
    AppState.currentState = 'active';
    jest.mocked(configService.getConfig).mockResolvedValue(DEFAULT_APP_CONFIG);
    const service = getClipboardSyncService();
    const handler = mockHandler;
    await service.start();
    try {
      const monitor = side === 'local' ? clipboardMonitor : remoteClipboardMonitor;
      const callback = jest.mocked(monitor.addCallback).mock.calls[0][0];
      const handle =
        side === 'local' ? handler.handleAutoUpload : handler.processRemoteClipboardContent;
      const reset =
        side === 'local' ? handler.resetLastLocalProfileHash : handler.resetLastRemoteProfileHash;
      jest.mocked(reset).mockClear();
      let finish!: () => void;
      jest.mocked(handle).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve;
        })
      );
      const processing = callback({ type: 'Text', text: 'A', hasData: false });
      AppState.currentState = 'background';
      for (const [, listener] of jest.mocked(AppState.addEventListener).mock.calls) {
        listener('background');
      }
      service.onConfigChanged(DEFAULT_APP_CONFIG);
      if (side === 'local') {
        expect(handle.mock.calls[0]).toHaveLength(1);
      } else {
        expect(handle.mock.calls[0][1].aborted).toBe(false);
      }
      await callback({ type: 'Text', text: 'B', hasData: false });
      expect(handle).toHaveBeenCalledTimes(1);
      expect(clipboardSyncState.clearUploadState).not.toHaveBeenCalled();
      expect(clipboardSyncState.clearDownloadState).not.toHaveBeenCalled();
      finish();
      await processing;
      expect(reset).not.toHaveBeenCalled();
    } finally {
      await service.stop();
      AppState.currentState = 'active';
    }
  }
);

it('only carries an upload echo marker across configuration changes for the same server', async () => {
  const config = {
    ...DEFAULT_APP_CONFIG,
    servers: [
      { type: 'webdav' as const, url: 'https://a.example' },
      { type: 'webdav' as const, url: 'https://b.example' },
    ],
    activeServerIndex: 0,
  };
  jest.mocked(configService.getConfig).mockResolvedValue(config);
  const service = getClipboardSyncService();
  await service.start();
  try {
    setJustUploadedHash('same-text-hash');
    service.onConfigChanged({
      ...config,
      servers: [{ ...config.servers[0], name: 'Renamed' }, config.servers[1]],
      enableBackgroundUpload: !config.enableBackgroundUpload,
    });
    expect(getJustUploadedHash()).toBe('same-text-hash');
    service.onConfigChanged({ ...config, activeServerIndex: 1 });
    expect(getJustUploadedHash()).toBeNull();
  } finally {
    clearJustUploadedHash();
    await service.stop();
  }
});

it.each([true, false])(
  'honors background capability %s with the same imported settings',
  async (supported) => {
    jest.clearAllMocks();
    jest.mocked(configService.getConfig).mockResolvedValue({
      ...DEFAULT_APP_CONFIG,
      autoSync: false,
      enableBackgroundTasks: true,
      enableBackgroundUpload: true,
      enableBackgroundDownload: true,
    });
    const service = getClipboardSyncService();
    await service.start(supported);
    try {
      AppState.currentState = 'inactive';
      expect(await mockReadConfig()).toMatchObject({
        autoSync: false,
        enableBackgroundUpload: supported,
        enableBackgroundDownload: supported,
      });
      AppState.currentState = 'background';
      const callback = jest.mocked(clipboardMonitor.addCallback).mock.calls[0][0];
      await callback({ type: 'Text', text: 'A', hasData: false });
      expect(mockHandler.handleAutoUpload).toHaveBeenCalledTimes(supported ? 1 : 0);
    } finally {
      await service.stop();
      AppState.currentState = 'active';
    }
  }
);
