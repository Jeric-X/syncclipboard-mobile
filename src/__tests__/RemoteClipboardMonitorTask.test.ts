jest.mock('../services/ConfigService', () => ({
  configService: {
    getActiveServer: jest.fn(),
    getConfig: jest.fn(),
  },
}));

jest.mock('../services/sync/RemoteClipboardMonitor', () => ({
  remoteClipboardMonitor: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    isConnected: jest.fn(),
    handleBackground: jest.fn(),
    handleForeground: jest.fn(),
  },
}));

jest.mock('../services/sync/SyncState', () => ({
  clipboardSyncState: {
    setRemoteContent: jest.fn(),
  },
}));

import { RemoteClipboardMonitorTask } from '../longRunningTask/RemoteClipboardMonitorTask';
import { configService } from '../services/ConfigService';
import { remoteClipboardMonitor } from '../services/sync/RemoteClipboardMonitor';
import { clipboardSyncState } from '../services/sync/SyncState';
import type { ServerConfig } from '../types/api';

describe('RemoteClipboardMonitorTask', () => {
  const server: ServerConfig = {
    id: 'home',
    name: 'Home',
    type: 'syncclipboard',
    url: 'https://home.example',
  };
  const mockedConfig = configService as jest.Mocked<typeof configService>;
  const mockedMonitor = remoteClipboardMonitor as jest.Mocked<typeof remoteClipboardMonitor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedConfig.getConfig.mockResolvedValue({ remotePollingInterval: 3000 } as never);
    mockedMonitor.connect.mockResolvedValue(undefined);
    mockedMonitor.disconnect.mockResolvedValue(undefined);
    mockedMonitor.isConnected.mockReturnValue(false);
  });

  it('没有服务器时仍保持任务运行，后续匹配服务器后建立连接', async () => {
    mockedConfig.getActiveServer.mockResolvedValueOnce(null).mockResolvedValueOnce(server);
    const task = new RemoteClipboardMonitorTask();

    await task.start();
    expect(task.isRunning()).toBe(true);
    expect(clipboardSyncState.setRemoteContent).toHaveBeenCalledWith(null);
    expect(mockedMonitor.connect).not.toHaveBeenCalled();

    await task.onConfigChanged();
    expect(task.isRunning()).toBe(true);
    expect(mockedMonitor.connect).toHaveBeenCalledTimes(1);
  });

  it('切换到不使用服务器时只断开传输，不停止任务', async () => {
    mockedConfig.getActiveServer.mockResolvedValueOnce(server).mockResolvedValueOnce(null);
    const task = new RemoteClipboardMonitorTask();

    await task.start();
    await task.onConfigChanged();

    expect(mockedMonitor.disconnect).toHaveBeenCalledTimes(1);
    expect(task.isRunning()).toBe(true);
  });
});
