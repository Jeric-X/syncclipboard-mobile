import { foregroundServiceTask } from '../longRunningTask/ForegroundServiceTask';
import * as ForegroundService from 'foreground-service';
import { configService } from '../services/ConfigService';
import { backgroundRuntimeState } from '../services/BackgroundRuntimeState';
import { acquireStartupOverlay } from '../services/overlay/OverlayManager';
import { nativeSleep } from 'native-timer';
import type { AppConfig } from '../types/storage';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('foreground-service', () => ({
  isRunning: jest.fn(),
  startService: jest.fn(),
  stopService: jest.fn(),
  startHeadlessRuntime: jest.fn(),
  getSessionId: jest.fn(),
  getStopReason: jest.fn(),
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
jest.mock('../services/overlay/OverlayManager', () => ({ acquireStartupOverlay: jest.fn() }));
jest.mock('native-timer', () => ({ nativeSleep: jest.fn() }));

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

test('a running foreground service is reused without requesting a headless session', async () => {
  jest.mocked(ForegroundService.isRunning).mockReturnValue(true);
  await foregroundServiceTask.start();
  expect(ForegroundService.startService).not.toHaveBeenCalled();
  expect(ForegroundService.startHeadlessRuntime).not.toHaveBeenCalled();
  await foregroundServiceTask.start();
  expect(ForegroundService.startHeadlessRuntime).not.toHaveBeenCalled();
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
  expect(ForegroundService.startHeadlessRuntime).not.toHaveBeenCalled();
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

test('turning the notification option off cancels native requests without starting either side', async () => {
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

test.each([false, true])(
  'failed startup invalidates late native requests (overlay: %s)',
  async (overlayAvailable) => {
    let pending = false;
    let running = false;
    jest.mocked(ForegroundService.isRunning).mockImplementation(() => running);
    jest.mocked(ForegroundService.startService).mockImplementation(() => {
      pending = true;
      return true;
    });
    jest.mocked(ForegroundService.stopService).mockImplementation(() => {
      pending = false;
      running = false;
      return true;
    });
    const release = jest.fn(async () => {});
    jest.mocked(acquireStartupOverlay).mockResolvedValue(overlayAvailable ? release : null);
    await expect(foregroundServiceTask.start()).rejects.toThrow('bounded retries');
    // 模拟在最后一次 JS 状态观察后才到达的原生启动。
    if (pending) running = true;
    expect(running).toBe(false);
    expect(ForegroundService.stopService).toHaveBeenCalledTimes(1);
    expect(ForegroundService.startService).toHaveBeenCalledTimes(overlayAvailable ? 2 : 1);
    expect(release).toHaveBeenCalledTimes(overlayAvailable ? 1 : 0);
    expect(foregroundServiceTask.isRunning()).toBe(false);
  }
);

test('service destruction during config reading fails without creating another Headless session', async () => {
  let running = true;
  jest.mocked(ForegroundService.isRunning).mockImplementation(() => running);
  const config = await configService.getConfig();
  let reads = 0;
  jest.mocked(configService.getConfig).mockImplementation(async () => {
    if (++reads === 3) running = false;
    return config;
  });
  await expect(foregroundServiceTask.start()).rejects.toThrow('Foreground service stopped');
  expect(ForegroundService.startHeadlessRuntime).not.toHaveBeenCalled();
  expect(foregroundServiceTask.isRunning()).toBe(false);
  jest.mocked(ForegroundService.startService).mockImplementation(() => {
    running = true;
    return true;
  });
  await foregroundServiceTask.start();
  expect(ForegroundService.startService).toHaveBeenCalledTimes(1);
  expect(foregroundServiceTask.isRunning()).toBe(true);
});

test('disabling notifications stops an existing service but never creates a Headless session', async () => {
  jest.mocked(ForegroundService.isRunning).mockReturnValue(true);
  jest.mocked(configService.getConfig).mockResolvedValue({
    enableBackgroundTasks: true,
    enableForegroundNotification: false,
    enableBackgroundUpload: true,
  } as AppConfig);
  await foregroundServiceTask.start();
  expect(ForegroundService.stopService).toHaveBeenCalledTimes(1);
  expect(ForegroundService.startHeadlessRuntime).not.toHaveBeenCalled();
});

test('a replacement JS task cancels a delayed native start when notifications are disabled', async () => {
  let pendingNativeIntent = true;
  jest.mocked(ForegroundService.isRunning).mockReturnValue(false);
  jest.mocked(ForegroundService.stopService).mockImplementation(() => {
    pendingNativeIntent = false;
    return true;
  });
  jest.mocked(configService.getConfig).mockResolvedValue({
    enableBackgroundTasks: true,
    enableForegroundNotification: false,
    enableBackgroundUpload: true,
  } as AppConfig);
  await foregroundServiceTask.start();
  expect(pendingNativeIntent).toBe(false);
  expect(ForegroundService.startService).not.toHaveBeenCalled();
});

test.each(['sleep', 'config'])(
  'startup rejection cancels a queued native request (%s)',
  async (failure) => {
    let pending = false;
    jest.mocked(ForegroundService.isRunning).mockReturnValue(false);
    jest.mocked(ForegroundService.startService).mockImplementation(() => {
      pending = true;
      return true;
    });
    jest.mocked(ForegroundService.stopService).mockImplementation(() => {
      pending = false;
      return true;
    });
    jest.mocked(nativeSleep).mockImplementationOnce(async () => {
      if (failure === 'sleep') throw new Error('startup dependency failed');
      jest
        .mocked(configService.getConfig)
        .mockRejectedValueOnce(new Error('startup dependency failed'));
    });
    await expect(foregroundServiceTask.start()).rejects.toThrow('startup dependency failed');
    expect(pending).toBe(false);
    expect(ForegroundService.stopService).toHaveBeenCalledTimes(1);
    expect(foregroundServiceTask.isRunning()).toBe(false);
    expect(ForegroundService.startService).toHaveBeenCalledTimes(1);
  }
);
