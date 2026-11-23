import { AppState } from 'react-native';
import { configService } from '../services/ConfigService';
import { clipboardMonitor } from '../services/clipboard/ClipboardMonitor';
import { remoteClipboardMonitor } from '../services/sync/RemoteClipboardMonitor';
import { getClipboardSyncService } from '../services/sync/ClipboardSyncService';
import { getClipboardChangedHandler } from '../services/sync/ClipboardChangedHandler';
import { DEFAULT_APP_CONFIG } from '../types/storage';

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { currentState: 'active' },
}));
jest.mock('../services/ConfigService', () => ({ configService: { getConfig: jest.fn() } }));
function mockMonitor() {
  return {
    addBackgroundRunningChecker: jest.fn(),
    removeBackgroundRunningChecker: jest.fn(),
    addCallback: jest.fn(),
    removeCallback: jest.fn(),
    reset: jest.fn(),
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
  clipboardSyncState: { clearDownloadState: jest.fn(), setRemoteContent: jest.fn() },
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
jest.mock('../services/sync/ClipboardChangedHandler', () => {
  const handler = {
    handleAutoUpload: jest.fn(),
    processRemoteClipboardContent: jest.fn(),
    resetLastLocalProfileHash: jest.fn(),
    resetLastRemoteProfileHash: jest.fn(),
  };
  return { getClipboardChangedHandler: () => handler };
});

it.each(['local', 'remote'])(
  'invalidates a %s change that finishes in background before the task stops',
  async (side) => {
    jest.clearAllMocks();
    AppState.currentState = 'active';
    jest.mocked(configService.getConfig).mockResolvedValue(DEFAULT_APP_CONFIG);
    const service = getClipboardSyncService();
    const handler = getClipboardChangedHandler();
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
      finish();
      await processing;
      await service.stop();
      expect(reset).toHaveBeenCalled();
      if (side === 'local') expect(clipboardMonitor.reset).toHaveBeenCalled();
    } finally {
      await service.stop();
      AppState.currentState = 'active';
    }
  }
);
