import { Platform } from 'react-native';
import { setRecoveryEnabled } from 'shizuku-clipboard';
import { getStopReason } from 'foreground-service';
import { ShizukuRecoveryTask } from '../longRunningTask/ShizukuRecoveryTask';
import { configService } from '../services/ConfigService';
import { backgroundRuntimeState } from '../services/BackgroundRuntimeState';
import { DEFAULT_APP_CONFIG, type AppConfig } from '../types/storage';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('shizuku-clipboard', () => ({ setRecoveryEnabled: jest.fn() }));
jest.mock('foreground-service', () => ({ getStopReason: jest.fn() }));
jest.mock('../services/ConfigService', () => ({
  configService: { getConfig: jest.fn(), subscribe: jest.fn() },
}));
jest.mock('../services/BackgroundRuntimeState', () => ({
  backgroundRuntimeState: { isTempDisabled: jest.fn(), subscribe: jest.fn() },
}));

const enabledConfig: AppConfig = {
  ...DEFAULT_APP_CONFIG,
  enableBackgroundTasks: true,
  enableShizukuRecovery: true,
  enableForegroundNotification: true,
  enableBackgroundDownload: true,
  enableBackgroundUpload: false,
  enableShizukuClipboard: false,
};
let task: ShizukuRecoveryTask;
let changed: (config: AppConfig) => void;
let stateChanged: () => void;
const unsubscribe = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  task = new ShizukuRecoveryTask();
  (configService.getConfig as jest.Mock).mockResolvedValue(enabledConfig);
  (configService.subscribe as jest.Mock).mockImplementation((listener) => {
    changed = listener;
    return unsubscribe;
  });
  (backgroundRuntimeState.subscribe as jest.Mock).mockImplementation((listener) => {
    stateChanged = listener;
    return unsubscribe;
  });
  (backgroundRuntimeState.isTempDisabled as jest.Mock).mockReturnValue(false);
  (getStopReason as jest.Mock).mockReturnValue(null);
});

it('defaults to off and does not arm on iOS', async () => {
  (configService.getConfig as jest.Mock).mockResolvedValue(DEFAULT_APP_CONFIG);
  await task.start();
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(false);
  await task.stop();
  jest.clearAllMocks();
  Platform.OS = 'ios';
  await task.start();
  expect(setRecoveryEnabled).not.toHaveBeenCalled();
  expect(task.isRunning()).toBe(false);
});

it('guards independently of clipboard and Sticky recovery settings', async () => {
  (configService.getConfig as jest.Mock).mockResolvedValue({
    ...enabledConfig,
    enableForegroundServiceSticky: false,
  });
  await task.start();
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(true);
});

it.each([
  { enableShizukuRecovery: false },
  { enableShizukuRecovery: undefined },
  { enableBackgroundTasks: false },
  { enableForegroundNotification: false },
  { enableBackgroundDownload: false, enableBackgroundUpload: false },
])('immediately revokes on saved configuration changes: %j', async (flags) => {
  await task.start();
  changed({ ...enabledConfig, ...flags } as AppConfig);
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(false);
});

it('revokes on temporary stop before the task manager finishes shutdown', async () => {
  await task.start();
  (backgroundRuntimeState.isTempDisabled as jest.Mock).mockReturnValue(true);
  stateChanged();
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(false);
});

it.each(['stop', 'temporary'])('honors native stop reason %s', async (reason) => {
  (getStopReason as jest.Mock).mockReturnValue(reason);
  await task.start();
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(false);
});

it('does not rearm when the initial read finishes after shutdown', async () => {
  let resolve!: (config: AppConfig) => void;
  (configService.getConfig as jest.Mock).mockReturnValue(new Promise((done) => (resolve = done)));
  const starting = task.start();
  await task.stop();
  resolve(enabledConfig);
  await starting;
  expect(setRecoveryEnabled).toHaveBeenCalledTimes(1);
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(false);
  expect(unsubscribe).toHaveBeenCalledTimes(2);
});

it('does not overwrite a newer saved setting with an old initial read', async () => {
  let resolve!: (config: AppConfig) => void;
  (configService.getConfig as jest.Mock).mockReturnValue(new Promise((done) => (resolve = done)));
  const starting = task.start();
  changed({ ...enabledConfig, enableShizukuRecovery: false });
  resolve(enabledConfig);
  await starting;
  expect(setRecoveryEnabled).toHaveBeenCalledTimes(1);
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(false);
});
