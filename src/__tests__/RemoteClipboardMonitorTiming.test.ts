import { remoteClipboardMonitor } from '../services/sync/RemoteClipboardMonitor';
import { clipboardSyncState } from '../services/sync/SyncState';

jest.mock('signalr-client', () => ({
  getSignalRClient: () => ({
    onRemoteClipboardChanged: jest.fn(),
    onConnectionStateChanged: jest.fn(),
    connect: async () => {
      throw new Error('unauthorized');
    },
  }),
}));
jest.mock('native-timer', () => ({ setTimer: jest.fn(), clearTimer: jest.fn() }));
jest.mock('../services/ClientFactory', () => ({ getAPIClient: jest.fn() }));
jest.mock('../services/sync/SyncState', () => ({
  clipboardSyncState: { setSyncError: jest.fn() },
}));
jest.mock('../services/ConfigService', () => ({
  configService: {
    getConfig: async () => ({}),
    getActiveServer: async () => ({ type: 'syncclipboard' }),
  },
}));

it('连接异常仍由监听器处理，但启动日志必须记录失败', async () => {
  const info = jest.spyOn(console, 'info').mockImplementation(() => {});
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(remoteClipboardMonitor.connect()).resolves.toBeUndefined();
    expect(clipboardSyncState.setSyncError).toHaveBeenCalled();
    const events = info.mock.calls.map(([line]) =>
      JSON.parse(String(line).replace('[StartupTiming] ', ''))
    );
    expect(events).toContainEqual(
      expect.objectContaining({ stage: 'remote.connectSignalR', event: 'end', succeeded: false })
    );
  } finally {
    info.mockRestore();
    error.mockRestore();
  }
});
