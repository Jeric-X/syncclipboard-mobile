import { RemoteClipboardMonitorTask } from '../longRunningTask/RemoteClipboardMonitorTask';
import { remoteClipboardMonitor } from '../services/sync/RemoteClipboardMonitor';
import { configService } from '../services/ConfigService';
import { getAPIClient } from '../services/ClientFactory';
import { getSignalRClient } from 'signalr-client';
import { clipboardSyncState } from '../services/sync/SyncState';

jest.mock('../services/ConfigService', () => ({
  configService: { getConfig: jest.fn(), getActiveServer: jest.fn() },
}));
jest.mock('../services/ClientFactory', () => ({ getAPIClient: jest.fn() }));
jest.mock('../services/sync/SyncState', () => ({
  clipboardSyncState: {
    setRemoteContent: jest.fn(),
    setSyncError: jest.fn(),
    clearSyncError: jest.fn(),
  },
}));
jest.mock('native-timer', () => ({ setTimer: jest.fn(), clearTimer: jest.fn() }));
jest.mock('signalr-client', () => ({ getSignalRClient: jest.fn() }));

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const server = { id: 'a', type: 'syncclipboard' as const, url: 'https://a.example' };
const client = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  isConnected: jest.fn(),
  onRemoteClipboardChanged: jest.fn(),
  offRemoteClipboardChanged: jest.fn(),
  onConnectionStateChanged: jest.fn(),
  offConnectionStateChanged: jest.fn(),
};
let task: RemoteClipboardMonitorTask;
let getClipboard: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  client.connect.mockReset().mockResolvedValue(undefined);
  client.disconnect.mockResolvedValue(undefined);
  client.isConnected.mockReturnValue(true);
  jest.mocked(getSignalRClient).mockReturnValue(client as never);
  jest.mocked(configService.getConfig).mockResolvedValue({ remotePollingInterval: 3000 } as never);
  jest.mocked(configService.getActiveServer).mockResolvedValue(server);
  getClipboard = jest.fn().mockResolvedValue({ type: 'Text', text: 'ready', hash: 'ready' });
  jest.mocked(getAPIClient).mockResolvedValue({ getClipboard } as never);
  task = new RemoteClipboardMonitorTask();
});
afterEach(async () => {
  await task.stop();
});

it('远程拉取未完成时启动和前台恢复立即完成，重复入口共用一次请求', async () => {
  let complete!: () => void;
  getClipboard.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      })
  );
  const started = jest.fn();
  const foreground = jest.fn();
  void task.start().then(started);
  await flush();
  void task.onForeground().then(foreground);
  await flush();
  expect(started).toHaveBeenCalledTimes(1);
  expect(foreground).toHaveBeenCalledTimes(1);
  expect(client.connect).toHaveBeenCalledTimes(1);
  expect(getClipboard).toHaveBeenCalledTimes(1);
  await task.stop();
  complete();
  await flush();
});

it('停止期间未完成的连接返回后不能重新拉取或恢复连接状态', async () => {
  let connected!: () => void;
  client.connect.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        connected = resolve;
      })
  );
  void task.start();
  await flush();
  await task.stop();
  connected();
  await flush();
  expect(remoteClipboardMonitor.isConnected()).toBe(false);
  expect(getClipboard).not.toHaveBeenCalled();
  expect(client.disconnect).toHaveBeenCalled();
});

it('服务器切换后忽略旧请求的迟到结果，仅发布新服务器内容', async () => {
  const received = jest.fn();
  remoteClipboardMonitor.addCallback(received);
  let oldResult!: (value: unknown) => void;
  getClipboard.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        oldResult = resolve;
      })
  );
  void task.start();
  await flush();
  jest
    .mocked(configService.getActiveServer)
    .mockResolvedValue({ ...server, id: 'b', url: 'https://b.example' });
  await task.onConfigChanged();
  await flush();
  oldResult({ type: 'Text', text: 'stale', hash: 'stale' });
  await flush();
  expect(received.mock.calls.map(([content]) => content.text)).toEqual(['ready']);
  remoteClipboardMonitor.removeCallback(received);
});

it('异步连接失败更新错误状态，不使任务启动失败', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    client.connect.mockRejectedValue(new Error('offline'));
    await task.start();
    await flush();
    expect(task.isRunning()).toBe(true);
    expect(clipboardSyncState.setSyncError).toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});

it('SignalR 断线但 HTTP 仍可用时，回到前台仍拉取最新内容', async () => {
  await task.start();
  await flush();
  expect(getClipboard).toHaveBeenCalledTimes(1);
  client.isConnected.mockReturnValue(false);
  await task.onForeground();
  await flush();
  expect(getClipboard).toHaveBeenCalledTimes(2);
});
