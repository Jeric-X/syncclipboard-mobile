import { longRunningTaskManager } from '../longRunningTask/LongRunningTaskManager';
import type { ILongRunningTask } from '../longRunningTask/LongRunningTask';

let mockListener: ((value: string) => void) | undefined;
const mockHistory: string[] = [];
function mockTask(name: string, start = () => {}, stop = () => {}): ILongRunningTask {
  let running = false;
  return {
    name,
    isRunning: () => running,
    start: async () => {
      running = true;
      start();
    },
    stop: async () => {
      running = false;
      stop();
    },
    onConfigChanged: async () => {},
    onForeground: async () => {},
    onBackground: async () => {},
  };
}
jest.mock('react-native', () => ({
  AppState: { currentState: 'background', addEventListener: jest.fn() },
}));
jest.mock('../services/ConfigService', () => ({
  configService: {
    getConfig: async () => ({ enableBackgroundTasks: false }),
    subscribe: jest.fn(),
  },
}));
jest.mock('../services/BackgroundRuntimeState', () => ({
  backgroundRuntimeState: {
    isTempDisabled: () => false,
    subscribe: jest.fn(),
  },
}));
jest.mock('../longRunningTask/HistoryTrackerTask', () => ({
  historyTrackerTask: mockTask(
    'history',
    () => {
      mockListener = (value) => mockHistory.push(value);
    },
    () => {
      mockListener = undefined;
    }
  ),
}));
jest.mock('../longRunningTask/ClipboardMonitorTask', () => ({
  clipboardMonitorTask: mockTask('clipboard', () => mockListener?.('initial clipboard')),
}));
jest.mock('../longRunningTask/SmsForwardingTask', () => ({
  smsForwardingTask: mockTask('smsForwardingTask'),
}));
jest.mock('../longRunningTask/ShizukuRecoveryTask', () => ({
  shizukuRecoveryTask: mockTask('shizukuRecoveryTask'),
}));
jest.mock('../longRunningTask/ForegroundServiceTask', () => ({
  foregroundServiceTask: mockTask('foregroundServiceTask'),
}));
jest.mock('../longRunningTask/HistorySyncTask', () => ({
  historySyncTask: mockTask('historySyncTask'),
}));
jest.mock('../longRunningTask/ClipboardSyncTask', () => ({
  clipboardSyncTask: mockTask('clipboardSyncTask'),
}));
jest.mock('../longRunningTask/RemoteClipboardMonitorTask', () => ({
  remoteClipboardMonitorTask: mockTask('remoteClipboardMonitorTask'),
}));
jest.mock('../longRunningTask/NetworkAutoSwitchTask', () => ({
  networkAutoSwitchTask: mockTask('networkAutoSwitchTask'),
}));

it('后台同步关闭时，Headless 首次读到的剪贴板仍然进入历史', async () => {
  await longRunningTaskManager.startAll();
  try {
    expect(mockHistory).toEqual(['initial clipboard']);
  } finally {
    await longRunningTaskManager.stopAll();
  }
});
