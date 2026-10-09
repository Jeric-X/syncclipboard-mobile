jest.mock('react-native', () => ({
  AppState: { currentState: 'background', addEventListener: jest.fn() },
  Platform: { OS: 'android' },
}));
jest.mock('foreground-service', () => ({
  getStopReason: jest.fn(),
  clearStopReason: jest.fn(),
  getSessionId: jest.fn(),
}));
jest.mock('../services/ConfigService', () => ({
  configService: { getConfig: jest.fn(), updateConfig: jest.fn() },
}));
jest.mock('../services/BackgroundRuntimeState', () => ({
  backgroundRuntimeState: { setTempDisabled: jest.fn() },
}));
jest.mock('../longRunningTask/LongRunningTaskManager', () => ({
  longRunningTaskManager: { startAll: jest.fn(), stopAll: jest.fn() },
}));
jest.mock('../stores/settingsStore', () => ({ useSettingsStore: { setState: jest.fn() } }));
jest.mock('../utils/Logger', () => ({ initLogger: jest.fn() }));
jest.mock('../utils/clipboardProxy', () => ({ dismissOverlay: jest.fn() }));
jest.mock('../services/sync/ClipboardChangedHandler', () => {
  const handler = { initializeStartupBaseline: jest.fn() };
  return { getClipboardChangedHandler: () => handler };
});

import { AppState, Platform } from 'react-native';
import * as ForegroundService from 'foreground-service';
import {
  installServiceRuntime,
  startServiceRuntime,
  stopServiceRuntimeIfIdle,
} from '../services/ServiceRuntime';
import { configService } from '../services/ConfigService';
import { backgroundRuntimeState } from '../services/BackgroundRuntimeState';
import { longRunningTaskManager } from '../longRunningTask/LongRunningTaskManager';
import { dismissOverlay } from '../utils/clipboardProxy';
import { getClipboardChangedHandler } from '../services/sync/ClipboardChangedHandler';

describe('service runtime bootstrap', () => {
  let stopReason: string | null;
  beforeEach(() => {
    jest.clearAllMocks();
    AppState.currentState = 'background';
    stopReason = null;
    (ForegroundService.getStopReason as jest.Mock).mockImplementation(() => stopReason);
    (ForegroundService.clearStopReason as jest.Mock).mockImplementation(() => {
      stopReason = null;
    });
    (ForegroundService.getSessionId as jest.Mock).mockReturnValue(null);
    (configService.getConfig as jest.Mock).mockResolvedValue({ enableBackgroundTasks: true });
    (configService.updateConfig as jest.Mock).mockResolvedValue({ enableBackgroundTasks: false });
    (longRunningTaskManager.startAll as jest.Mock).mockResolvedValue(undefined);
  });

  it('shares configuration initialization across simultaneous entry points', async () => {
    const first = startServiceRuntime();
    const second = startServiceRuntime();
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(longRunningTaskManager.startAll).toHaveBeenCalledTimes(1);
    const initializeBaseline = getClipboardChangedHandler().initializeStartupBaseline as jest.Mock;
    expect(initializeBaseline).toHaveBeenCalledWith(true);
    expect(initializeBaseline.mock.invocationCallOrder[0]).toBeLessThan(
      (longRunningTaskManager.startAll as jest.Mock).mock.invocationCallOrder[0]
    );
  });

  it('persists a stop received before JS was ready before starting any tasks', async () => {
    stopReason = 'stop';
    await startServiceRuntime();
    expect(configService.updateConfig).toHaveBeenCalledWith({ enableBackgroundTasks: false });
    expect((configService.updateConfig as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (longRunningTaskManager.startAll as jest.Mock).mock.invocationCallOrder[0]
    );
    expect(stopReason).toBeNull();
  });

  it('does not let a Headless task clear temporary pause even while an Activity is active', async () => {
    AppState.currentState = 'active';
    stopReason = 'temporary';
    await startServiceRuntime();
    expect(ForegroundService.clearStopReason).not.toHaveBeenCalled();
    expect(backgroundRuntimeState.setTempDisabled).toHaveBeenCalledWith(true);
  });

  it('resumes temporary pause on an explicit foreground entry', async () => {
    AppState.currentState = 'active';
    stopReason = 'temporary';
    await startServiceRuntime(true);
    expect(stopReason).toBeNull();
    expect(backgroundRuntimeState.setTempDisabled).toHaveBeenCalledWith(false);
    expect(getClipboardChangedHandler().initializeStartupBaseline).toHaveBeenCalledWith(false);
  });

  it('does not lose a foreground resume arriving during Headless initialization', async () => {
    stopReason = 'temporary';
    const headless = startServiceRuntime();
    AppState.currentState = 'active';
    const foreground = startServiceRuntime(true);
    await Promise.all([headless, foreground]);
    expect(stopReason).toBeNull();
    expect(backgroundRuntimeState.setTempDisabled).toHaveBeenLastCalledWith(false);
  });

  it('does not dispose a runtime still owned by a newer native session or the foreground', async () => {
    (ForegroundService.getSessionId as jest.Mock).mockReturnValue('new-session');
    await stopServiceRuntimeIfIdle();
    (ForegroundService.getSessionId as jest.Mock).mockReturnValue(null);
    AppState.currentState = 'active';
    await stopServiceRuntimeIfIdle();
    expect(longRunningTaskManager.stopAll).not.toHaveBeenCalled();
  });

  it('disposes background tasks and overlay when the last service owner disappears', async () => {
    await stopServiceRuntimeIfIdle();
    expect(longRunningTaskManager.stopAll).toHaveBeenCalledTimes(1);
    expect(dismissOverlay).toHaveBeenCalledTimes(1);
  });

  it('initializes shared tasks on non-Android foregrounds and installs only once', async () => {
    const originalPlatform = Platform.OS;
    Platform.OS = 'ios';
    AppState.currentState = 'active';
    try {
      installServiceRuntime();
      expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
      expect(configService.getConfig).toHaveBeenCalled();
      await startServiceRuntime(true);
      expect(longRunningTaskManager.startAll).toHaveBeenCalled();

      installServiceRuntime();
      expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
      const onChange = (AppState.addEventListener as jest.Mock).mock.calls[0][1];
      (configService.getConfig as jest.Mock).mockClear();
      AppState.currentState = 'background';
      onChange();
      expect(configService.getConfig).not.toHaveBeenCalled();
      AppState.currentState = 'active';
      onChange();
      expect(configService.getConfig).toHaveBeenCalled();
      await startServiceRuntime(true);
    } finally {
      Platform.OS = originalPlatform;
    }
  });
});
