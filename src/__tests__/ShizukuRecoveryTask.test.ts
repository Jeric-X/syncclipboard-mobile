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
  enableBackgroundDownload: false,
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

it('guards independently of clipboard, foreground notification and Sticky settings', async () => {
  (configService.getConfig as jest.Mock).mockResolvedValue({
    ...enabledConfig,
    enableForegroundServiceSticky: false,
    enableForegroundNotification: false,
  });
  await task.start();
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(true);
});

it('arms recovery when both background upload and download are disabled', async () => {
  await task.start();
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(true);
});

it('keeps watching when both sync directions are disabled while running', async () => {
  (configService.getConfig as jest.Mock).mockResolvedValue({
    ...enabledConfig,
    enableBackgroundUpload: true,
    enableBackgroundDownload: true,
  });
  await task.start();
  changed(enabledConfig);
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(true);
});

it('keeps watching when foreground notifications are disabled while running', async () => {
  await task.start();
  changed({ ...enabledConfig, enableForegroundNotification: false });
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(true);
});

it.each([
  { enableShizukuRecovery: false },
  { enableShizukuRecovery: undefined },
  { enableBackgroundTasks: false },
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
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(false, true);
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

it('does not revoke recovery during cleanup before the task ever started', async () => {
  await task.stop();
  expect(setRecoveryEnabled).not.toHaveBeenCalled();
});

it('allows only failed-startup cleanup to preserve an otherwise enabled watch', async () => {
  await task.start();
  await task.stop();
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(false, true);
});

it('master switch off always revokes, including subsequent cleanup', async () => {
  await task.start();
  changed({ ...enabledConfig, enableBackgroundTasks: false });
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(false);
  await task.stop();
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(false, false);
});

it('revokes a persisted capability when the master switch was off before task startup', async () => {
  (configService.getConfig as jest.Mock).mockResolvedValue({
    ...enabledConfig,
    enableBackgroundTasks: false,
  });
  await task.stop();
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(false);
});

it('does not revoke an old capability when initialization could not load configuration', async () => {
  (configService.getConfig as jest.Mock).mockRejectedValue(new Error('storage unavailable'));
  await task.stop();
  expect(setRecoveryEnabled).not.toHaveBeenCalled();
});

it('old idle cleanup cannot revoke a newly started watch', async () => {
  let resolve!: (config: AppConfig) => void;
  (configService.getConfig as jest.Mock).mockReturnValueOnce(
    new Promise((done) => (resolve = done))
  );
  const cleanup = task.stop();
  await task.start();
  resolve({ ...enabledConfig, enableBackgroundTasks: false });
  await cleanup;
  expect(setRecoveryEnabled).toHaveBeenCalledTimes(1);
  expect(setRecoveryEnabled).toHaveBeenLastCalledWith(true);
});
