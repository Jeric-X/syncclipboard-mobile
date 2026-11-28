import { AppState, type AppStateStatus } from 'react-native';
import { clipboardMonitor } from '../services/clipboard/ClipboardMonitor';
import { setTimer } from 'native-timer';
import { longRunningTaskManager } from '../longRunningTask/LongRunningTaskManager';
import { configService } from '../services/ConfigService';
import { getAPIClient } from '../services/ClientFactory';
import { localClipboard } from '../services/clipboard/LocalClipboard';
import { getClipboardChangedHandler } from '../services/sync/ClipboardChangedHandler';
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
const server: ServerConfig = { id: 'web', type: 'webdav', url: 'http://localhost' };
const getClipboard = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  setAppState('active');
  jest.mocked(configService.getConfig).mockResolvedValue({
    ...DEFAULT_APP_CONFIG,
    localPollingInterval: 1234,
    remotePollingInterval: 4567,
  });
  jest.mocked(configService.getActiveServer).mockResolvedValue(server);
  jest.mocked(localClipboard.getClipboardContent).mockResolvedValue(null);
  jest.mocked(getAPIClient).mockResolvedValue({ getClipboard } as never);
  getClipboard.mockResolvedValue({ type: 'Text', text: 'remote', hash: 'remote' });
  jest.mocked(setTimer).mockImplementation((_tick, _interval, tag) => tag!);
});
afterEach(async () => {
  await longRunningTaskManager.stopAll();
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
