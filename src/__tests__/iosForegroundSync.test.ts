import { AppState, type AppStateStatus } from 'react-native';
import { clipboardMonitor } from '../services/clipboard/ClipboardMonitor';
import { setTimer, clearTimer } from 'native-timer';
import { getSignalRClient } from 'signalr-client';
import { longRunningTaskManager } from '../longRunningTask/LongRunningTaskManager';
import { configService } from '../services/ConfigService';
import { getAPIClient } from '../services/ClientFactory';
import { localClipboard } from '../services/clipboard/LocalClipboard';
import { getClipboardChangedHandler } from '../services/sync/ClipboardChangedHandler';
import { getHistoryTransferQueue } from '../services/history/HistoryTransferQueue';
import { DEFAULT_APP_CONFIG } from '../types/storage';
import type { ServerConfig } from '../types/api';

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: jest.fn() },
  Platform: { OS: 'ios' },
}));
jest.mock('../services/ConfigService', () => ({
  configService: { getConfig: jest.fn(), getActiveServer: jest.fn(), subscribe: jest.fn() },
}));
jest.mock('../services/ClientFactory', () => ({ getAPIClient: jest.fn() }));
jest.mock('../services/clipboard/LocalClipboard', () => ({
  localClipboard: {
    getClipboardContent: jest.fn(),
    registerRemoteCopiedCallback: jest.fn(),
    registerCopyLifecycleCallbacks: jest.fn(),
  },
}));
jest.mock('../services/sync/ClipboardChangedHandler', () => {
  const handler = {
    resetLastRemoteProfileHash: jest.fn(),
    handleAutoUpload: jest.fn(),
    processRemoteClipboardContent: jest.fn(),
  };
  return { getClipboardChangedHandler: () => handler };
});
jest.mock('../services/history/HistoryTransferQueue', () => {
  const queue = { onTaskStatusChanged: jest.fn(), offTaskStatusChanged: jest.fn() };
  return { getHistoryTransferQueue: () => queue };
});
jest.mock('../services/history/HistoryService', () => ({
  historyService: { addChangeCallback: jest.fn(), removeChangeCallback: jest.fn() },
}));
jest.mock('../services/sync/SyncState', () => ({
  clipboardSyncState: {
    setRemoteContent: jest.fn(),
    clearSyncError: jest.fn(),
    clearDownloadState: jest.fn(),
  },
}));
jest.mock('shizuku-clipboard', () => ({}));
jest.mock('../utils/clipboardProxy', () => ({}));
jest.mock('native-timer', () => ({ setTimer: jest.fn(), clearTimer: jest.fn() }));
jest.mock('signalr-client', () => ({ getSignalRClient: jest.fn() }));
jest.mock('../longRunningTask/NetworkAutoSwitchTask', () => ({}));
jest.mock('../longRunningTask/ShizukuRecoveryTask', () => ({}));
jest.mock('../longRunningTask/ForegroundServiceTask', () => ({}));
jest.mock('../longRunningTask/SmsForwardingTask', () => ({}));
jest.mock('../longRunningTask/HistorySyncTask', () => ({}));
jest.mock('../services/sync/historyChangedHandler', () => ({
  createHistoryChangedHandler: jest.fn(),
}));
jest.mock('../services/sync/historyTransferQueueChangedHandler', () => ({
  createTransferQueueChangedHandler: jest.fn(),
}));

const onAppState = jest.mocked(AppState.addEventListener).mock.calls[0][1];
const [onCopy] = jest.mocked(localClipboard.registerCopyLifecycleCallbacks).mock.calls[0];
function setAppState(state: AppStateStatus) {
  AppState.currentState = state;
  onAppState(state);
}

const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
const timers = new Map<string, () => void>();
const server: ServerConfig = { id: 'web', type: 'webdav', url: 'http://localhost' };
const getClipboard = jest.fn();
const signalR = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  isConnected: jest.fn(() => true),
  onRemoteClipboardChanged: jest.fn(),
  offRemoteClipboardChanged: jest.fn(),
  onConnectionStateChanged: jest.fn(),
  offConnectionStateChanged: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  setAppState('active');
  jest.mocked(configService.getConfig).mockResolvedValue({
    ...DEFAULT_APP_CONFIG,
    enableBackgroundTasks: true,
    enableBackgroundDownload: true,
    enableBackgroundUpload: true,
    localPollingInterval: 1234,
    remotePollingInterval: 4567,
  });
  jest.mocked(configService.getActiveServer).mockResolvedValue(server);
  jest.mocked(localClipboard.getClipboardContent).mockResolvedValue(null);
  jest.mocked(getAPIClient).mockResolvedValue({ getClipboard } as never);
  getClipboard.mockResolvedValue({ type: 'Text', text: 'remote', hash: 'remote' });
  jest.mocked(getSignalRClient).mockReturnValue(signalR as never);
  jest.mocked(setTimer).mockImplementation((tick, _interval, tag) => {
    timers.set(tag!, tick);
    return tag!;
  });
  jest.mocked(clearTimer).mockImplementation((tag) => {
    timers.delete(tag);
  });
});
afterEach(async () => {
  await longRunningTaskManager.stopAll();
  timers.clear();
});

it('每次进入前台只读一次本机，持续轮询远端，退后台保留监听任务并退订同步服务', async () => {
  setAppState('background');
  await longRunningTaskManager.startAll();
  expect(localClipboard.getClipboardContent).not.toHaveBeenCalled();
  expect(getClipboard).not.toHaveBeenCalled();

  const local = { type: 'Text' as const, text: 'phone', hasData: false };
  jest.mocked(localClipboard.getClipboardContent).mockResolvedValue(local);
  setAppState('active');
  await longRunningTaskManager.refresh();
  await drain();
  expect(localClipboard.getClipboardContent).toHaveBeenCalledTimes(1);
  expect(timers.has('clipboard_monitor')).toBe(false);
  expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 4567, 'remote_sync_poll');
  expect(getClipboardChangedHandler().handleAutoUpload).toHaveBeenCalledWith(local);
  getClipboard.mockResolvedValue({ type: 'Text', text: 'desktop', hash: 'desktop' });
  timers.get('remote_sync_poll')!();
  await drain();
  expect(getClipboardChangedHandler().processRemoteClipboardContent).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'desktop' })
  );

  setAppState('background');
  await longRunningTaskManager.refresh();
  await longRunningTaskManager.refresh(true);
  expect(longRunningTaskManager.isRunning('clipboardMonitor')).toBe(true);
  expect(longRunningTaskManager.isRunning('remoteClipboardMonitor')).toBe(true);
  expect(timers.size).toBe(0);
  expect(longRunningTaskManager.isRunning('clipboardSync')).toBe(false);
  expect(getHistoryTransferQueue().offTaskStatusChanged).toHaveBeenCalledTimes(1);

  setAppState('active');
  await longRunningTaskManager.refresh();
  await drain();
  expect(timers.size).toBe(1);
  expect(localClipboard.getClipboardContent).toHaveBeenCalledTimes(2);
  expect(longRunningTaskManager.isRunning('clipboardSync')).toBe(true);
  expect(getHistoryTransferQueue().onTaskStatusChanged).toHaveBeenCalledTimes(2);
});

it('前台切换到 SignalR，退后台后忽略旧连接的通知，恢复时只连接一次', async () => {
  await longRunningTaskManager.startAll();
  await drain();
  jest
    .mocked(configService.getActiveServer)
    .mockResolvedValue({ ...server, type: 'syncclipboard' });
  await longRunningTaskManager.refresh(true);
  await drain();
  expect(timers.has('remote_sync_poll')).toBe(false);
  expect(signalR.connect).toHaveBeenCalledTimes(1);
  const [onProfile] = signalR.onRemoteClipboardChanged.mock.calls[0];
  const processRemote = jest.mocked(getClipboardChangedHandler().processRemoteClipboardContent);
  processRemote.mockClear();
  onProfile({ type: 'Text', text: 'push', hash: 'push' });
  expect(processRemote).toHaveBeenCalledWith(expect.objectContaining({ text: 'push' }));

  setAppState('background');
  await longRunningTaskManager.refresh();
  onProfile({ type: 'Text', text: 'late', hash: 'late' });
  expect(processRemote).toHaveBeenCalledTimes(1);
  expect(signalR.disconnect).toHaveBeenCalledTimes(1);

  setAppState('active');
  await Promise.all([longRunningTaskManager.refresh(), longRunningTaskManager.startAll()]);
  await drain();
  expect(signalR.connect).toHaveBeenCalledTimes(2);
});

it('粘贴授权、调整设置和 App 内复制都不重复读板，手动刷新可以重读', async () => {
  await longRunningTaskManager.startAll();
  await drain();
  setAppState('inactive');
  await longRunningTaskManager.refresh(true);
  setAppState('active');
  await longRunningTaskManager.startAll();
  await drain();
  expect(localClipboard.getClipboardContent).toHaveBeenCalledTimes(1);

  // 系统弹窗出现前开始的 App 内写入，在 inactive 期间完成仍应通知卡片。
  jest.mocked(configService.getConfig).mockResolvedValue(DEFAULT_APP_CONFIG);
  setAppState('inactive');
  await longRunningTaskManager.refresh(true);
  const written = { type: 'Text' as const, text: 'copied', hasData: false };
  await onCopy.onBeforeCopy();
  await onCopy.onAfterCopy(written);
  expect(getClipboardChangedHandler().handleAutoUpload).toHaveBeenCalledWith(written);
  expect(localClipboard.getClipboardContent).toHaveBeenCalledTimes(1);
  setAppState('active');
  await longRunningTaskManager.refresh();
  await clipboardMonitor.triggerCheck();
  expect(localClipboard.getClipboardContent).toHaveBeenCalledTimes(2);
});

it('快速切出再返回时丢弃尚未完成的旧读取并补读一次', async () => {
  let finish!: (value: null) => void;
  jest.mocked(localClipboard.getClipboardContent).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await longRunningTaskManager.startAll();
  await drain();
  setAppState('background');
  setAppState('inactive');
  setAppState('active');
  await longRunningTaskManager.refresh();
  finish(null);
  await drain();
  expect(localClipboard.getClipboardContent).toHaveBeenCalledTimes(2);
  expect(timers.has('clipboard_monitor')).toBe(false);
});

it('排队的前台事件执行前已经退后台时，不发起陈旧的本机读取', async () => {
  setAppState('background');
  await longRunningTaskManager.startAll();
  setAppState('active');
  setAppState('background');
  await longRunningTaskManager.refresh();
  expect(localClipboard.getClipboardContent).not.toHaveBeenCalled();
  expect(getClipboard).not.toHaveBeenCalled();
});

it('断连期间连续切回两次只执行最后一次前台读取', async () => {
  jest
    .mocked(configService.getActiveServer)
    .mockResolvedValue({ ...server, type: 'syncclipboard' });
  await longRunningTaskManager.startAll();
  await drain();
  let finishDisconnect!: () => void;
  signalR.disconnect.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishDisconnect = resolve;
      })
  );
  setAppState('background');
  await drain();
  setAppState('active');
  setAppState('background');
  setAppState('active');
  finishDisconnect();
  await longRunningTaskManager.refresh();
  await drain();
  expect(localClipboard.getClipboardContent).toHaveBeenCalledTimes(2);
  expect(signalR.connect).toHaveBeenCalledTimes(2);
});
