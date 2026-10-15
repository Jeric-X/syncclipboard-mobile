import { foregroundServiceTask } from '../longRunningTask/ForegroundServiceTask';
import * as ForegroundService from 'foreground-service';
import { configService } from '../services/ConfigService';
import { backgroundRuntimeState } from '../services/BackgroundRuntimeState';
import { acquireStartupOverlay } from '../services/OverlayRuntime';
import { nativeSleep } from '../utils/nativeSleep';
import type { AppConfig } from '../types/storage';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('foreground-service', () => ({
  isRunning: jest.fn(),
  startService: jest.fn(),
  stopService: jest.fn(),
  startHeadlessRuntime: jest.fn(),
  getSessionId: jest.fn(),
  getStopReason: jest.fn(),
  cancelRestartNotification: jest.fn(),
  clearStopReason: jest.fn(),
  addStopListener: jest.fn(),
  addTempStopListener: jest.fn(),
  addSessionStoppedListener: jest.fn(),
}));
jest.mock('../services/ConfigService', () => ({
  configService: {
    getConfig: jest.fn(),
    subscribe: jest.fn(),
    updateConfig: jest.fn(),
  },
}));
jest.mock('../services/BackgroundRuntimeState', () => ({
  backgroundRuntimeState: {
    isTempDisabled: jest.fn(),
    subscribe: jest.fn(),
    setTempDisabled: jest.fn(),
  },
}));
jest.mock('../services/OverlayRuntime', () => ({ acquireStartupOverlay: jest.fn() }));
jest.mock('../utils/nativeSleep', () => ({ nativeSleep: jest.fn() }));

beforeEach(async () => {
  await foregroundServiceTask.stop();
  jest.resetAllMocks();
  jest.mocked(configService.getConfig).mockResolvedValue({
    enableBackgroundTasks: true,
    enableForegroundNotification: true,
    enableBackgroundUpload: true,
  } as AppConfig);
  jest.mocked(configService.subscribe).mockReturnValue(() => {});
  jest.mocked(backgroundRuntimeState.subscribe).mockReturnValue(() => {});
  jest.mocked(ForegroundService.startHeadlessRuntime).mockResolvedValue('session');
  jest.mocked(nativeSleep).mockResolvedValue();
  jest.mocked(acquireStartupOverlay).mockResolvedValue(null);
});

test('a running foreground service ensures the headless session without requesting another service', async () => {
  jest.mocked(ForegroundService.isRunning).mockReturnValue(true);
  await foregroundServiceTask.start();
  expect(ForegroundService.startService).not.toHaveBeenCalled();
  expect(ForegroundService.startHeadlessRuntime).toHaveBeenCalledTimes(1);
  await foregroundServiceTask.start();
  expect(ForegroundService.startHeadlessRuntime).toHaveBeenCalledTimes(1);
});

test('failed startup does not block a later independent headless entry from retrying', async () => {
  jest.mocked(ForegroundService.isRunning).mockReturnValue(false);
  await expect(foregroundServiceTask.start()).rejects.toThrow('bounded retries');
  expect(foregroundServiceTask.isRunning()).toBe(false);
  expect(ForegroundService.startHeadlessRuntime).not.toHaveBeenCalled();
  jest.mocked(ForegroundService.startService).mockImplementation(() => {
    jest.mocked(ForegroundService.isRunning).mockReturnValue(true);
    return true;
  });
  await foregroundServiceTask.start();
  expect(foregroundServiceTask.isRunning()).toBe(true);
  expect(ForegroundService.startHeadlessRuntime).toHaveBeenCalledTimes(1);
});

test('a stop while waiting prevents both the retry and a headless start', async () => {
  jest.mocked(ForegroundService.isRunning).mockReturnValue(false);
  jest.mocked(nativeSleep).mockImplementationOnce(async () => {
    await foregroundServiceTask.stop();
  });
  await foregroundServiceTask.start();
  expect(ForegroundService.startService).toHaveBeenCalledTimes(1);
  expect(acquireStartupOverlay).not.toHaveBeenCalled();
  expect(ForegroundService.startHeadlessRuntime).not.toHaveBeenCalled();
  expect(ForegroundService.stopService).toHaveBeenCalledTimes(1);
});

test('turning the notification option off does not start either side', async () => {
  jest.mocked(configService.getConfig).mockResolvedValue({
    enableBackgroundTasks: true,
    enableForegroundNotification: false,
    enableBackgroundUpload: true,
  } as AppConfig);
  await foregroundServiceTask.start();
  expect(ForegroundService.startService).not.toHaveBeenCalled();
  expect(ForegroundService.startHeadlessRuntime).not.toHaveBeenCalled();
  expect(ForegroundService.stopService).toHaveBeenCalledTimes(1);
});
