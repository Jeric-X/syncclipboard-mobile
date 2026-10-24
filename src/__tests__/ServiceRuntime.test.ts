jest.mock('react-native', () => ({
  AppState: { currentState: 'background', addEventListener: jest.fn() },
  Platform: { OS: 'android' },
}));
jest.mock('foreground-service', () => ({
  startHeadlessRuntime: jest.fn(),
  addSessionStoppedListener: jest.fn(),
  getStopReason: jest.fn(),
  clearStopReason: jest.fn(),
  getSessionId: jest.fn(),
  finishHeadlessRuntime: jest.fn(),
}));
jest.mock('../services/ConfigService', () => ({
  configService: { getConfig: jest.fn(), updateModule: jest.fn() },
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
jest.mock('../services/AppFoundation', () => ({ prepareAppFoundation: jest.fn() }));

import { headlessRuntimeInitialization } from '../services/headless/headlessRuntimeInitialization';
import { AppState, Platform } from 'react-native';
import * as ForegroundService from 'foreground-service';
import {
  installServiceRuntime,
  startServiceRuntime,
  requestServiceRuntime,
  stopServiceRuntimeIfIdle,
  stopServiceRuntime,
} from '../services/ServiceRuntime';
import { configService } from '../services/ConfigService';
import { backgroundRuntimeState } from '../services/BackgroundRuntimeState';
import { longRunningTaskManager } from '../longRunningTask/LongRunningTaskManager';
import { dismissOverlay } from '../utils/clipboardProxy';
import { prepareAppFoundation } from '../services/AppFoundation';

describe('service runtime bootstrap', () => {
  let stopReason: string | null;
  it('无 UI 的 sticky 启动在启动同步任务前初始化全局语言', async () => {
    await startServiceRuntime();
    expect(prepareAppFoundation).toHaveBeenCalledTimes(1);
    expect((prepareAppFoundation as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (longRunningTaskManager.startAll as jest.Mock).mock.invocationCallOrder[0]
    );
  });
  beforeEach(() => {
    jest.clearAllMocks();
    AppState.currentState = 'background';
    stopReason = null;
    (ForegroundService.getStopReason as jest.Mock).mockImplementation(() => stopReason);
    (ForegroundService.clearStopReason as jest.Mock).mockImplementation(() => {
      stopReason = null;
    });
    headlessRuntimeInitialization.end('runtime-1');
    (ForegroundService.getSessionId as jest.Mock).mockReturnValue('runtime-1');
    (ForegroundService.startHeadlessRuntime as jest.Mock).mockImplementation(async () => {
      void headlessRuntimeInitialization
        .initialize('runtime-1', startServiceRuntime)
        .catch(() => {});
      return 'runtime-1';
    });
    (configService.getConfig as jest.Mock).mockResolvedValue({ enableBackgroundTasks: true });
    (configService.updateModule as jest.Mock).mockResolvedValue({ enableBackgroundTasks: false });
    (longRunningTaskManager.startAll as jest.Mock).mockResolvedValue(undefined);
  });

  it('shares configuration initialization across simultaneous entry points', async () => {
    const first = startServiceRuntime();
    const second = startServiceRuntime();
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(longRunningTaskManager.startAll).toHaveBeenCalledTimes(1);
  });

  it('语言仍在读取时不能提前启动同步任务', async () => {
    let release!: () => void;
    (prepareAppFoundation as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const started = startServiceRuntime();
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      expect(longRunningTaskManager.startAll).not.toHaveBeenCalled();
    } finally {
      release();
      await started;
    }
    expect(longRunningTaskManager.startAll).toHaveBeenCalledTimes(1);
  });

  it('persists a stop received before JS was ready before starting any tasks', async () => {
    stopReason = 'stop';
    await startServiceRuntime();
    expect(configService.updateModule).toHaveBeenCalledWith('background', {
      enableBackgroundTasks: false,
    });
    expect((configService.updateModule as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (longRunningTaskManager.startAll as jest.Mock).mock.invocationCallOrder[0]
    );
    expect(stopReason).toBe('stop');
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
    await requestServiceRuntime(true);
    expect(stopReason).toBeNull();
    expect(backgroundRuntimeState.setTempDisabled).toHaveBeenCalledWith(false);
  });

  it('does not lose a foreground resume arriving during Headless initialization', async () => {
    stopReason = 'temporary';
    const headless = headlessRuntimeInitialization.initialize('runtime-1', startServiceRuntime);
    AppState.currentState = 'active';
    const foreground = requestServiceRuntime(true);
    await Promise.all([headless, foreground]);
    expect(stopReason).toBeNull();
    expect(backgroundRuntimeState.setTempDisabled).toHaveBeenLastCalledWith(false);
    expect(longRunningTaskManager.startAll).toHaveBeenCalledTimes(1);
  });

  it('Android UI waits for Headless initialization without initializing tasks itself', async () => {
    (ForegroundService.startHeadlessRuntime as jest.Mock).mockResolvedValue('runtime-1');
    const first = requestServiceRuntime();
    const second = requestServiceRuntime();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(longRunningTaskManager.startAll).not.toHaveBeenCalled();
    expect(ForegroundService.startHeadlessRuntime).toHaveBeenCalledTimes(1);
    await headlessRuntimeInitialization.initialize('runtime-1', startServiceRuntime);
    await Promise.all([first, second]);
    await requestServiceRuntime();
    expect(longRunningTaskManager.startAll).toHaveBeenCalledTimes(1);
  });

  it('rejects UI waiting when the native session ends before Headless starts', async () => {
    let stopped!: (event: { sessionId: string }) => void;
    const remove = jest.fn();
    (ForegroundService.addSessionStoppedListener as jest.Mock).mockImplementation((listener) => {
      stopped = listener;
      return { remove };
    });
    (ForegroundService.startHeadlessRuntime as jest.Mock).mockResolvedValue('runtime-1');
    const pending = requestServiceRuntime();
    const failure = expect(pending).rejects.toThrow('ended before initialization');
    await new Promise((resolve) => setTimeout(resolve, 0));
    stopped({ sessionId: 'runtime-1' });
    await failure;
    expect(remove).toHaveBeenCalled();
    expect(longRunningTaskManager.startAll).not.toHaveBeenCalled();
  });

  it('does not wait indefinitely when native session creation is refused', async () => {
    (ForegroundService.startHeadlessRuntime as jest.Mock).mockResolvedValue(null);
    await expect(requestServiceRuntime()).rejects.toThrow('could not be started');
    expect(longRunningTaskManager.startAll).not.toHaveBeenCalled();
  });

  it('quick-action requests wait for pending foreground resume before native creation', async () => {
    stopReason = 'temporary';
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    (configService.getConfig as jest.Mock).mockImplementationOnce(async () => {
      await blocked;
      return { enableBackgroundTasks: true };
    });
    (ForegroundService.startHeadlessRuntime as jest.Mock).mockImplementation(async () => {
      if (stopReason) return null;
      void headlessRuntimeInitialization
        .initialize('runtime-1', startServiceRuntime)
        .catch(() => {});
      return 'runtime-1';
    });
    const foreground = requestServiceRuntime(true);
    const quickAction = requestServiceRuntime();
    const results = Promise.allSettled([foreground, quickAction]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const earlyRequests = (ForegroundService.startHeadlessRuntime as jest.Mock).mock.calls.length;
    release();
    const completed = await results;
    expect(earlyRequests).toBe(0);
    expect(completed.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(ForegroundService.startHeadlessRuntime).toHaveBeenCalledTimes(1);
    expect(longRunningTaskManager.startAll).toHaveBeenCalledTimes(1);
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
    (ForegroundService.getSessionId as jest.Mock).mockReturnValue(null);
    await stopServiceRuntimeIfIdle();
    expect(longRunningTaskManager.stopAll).toHaveBeenCalledTimes(1);
    expect(dismissOverlay).toHaveBeenCalledTimes(1);
  });

  it('recovery resumes a temporary stop even when the process is already active', async () => {
    AppState.currentState = 'active';
    stopReason = 'temporary';
    (ForegroundService.startHeadlessRuntime as jest.Mock).mockImplementation(async () => {
      if (stopReason) return null;
      void headlessRuntimeInitialization
        .initialize('runtime-1', startServiceRuntime)
        .catch(() => {});
      return 'runtime-1';
    });
    await requestServiceRuntime(true);
    expect(stopReason).toBeNull();
    expect(backgroundRuntimeState.setTempDisabled).toHaveBeenCalledWith(false);
    expect(longRunningTaskManager.startAll).toHaveBeenCalledTimes(1);
  });

  it.each(['idle', 'new-session', 'foreground', 'rejected'])(
    'cleanup waits for in-flight initialization and rechecks ownership (%s)',
    async (owner) => {
      let release!: () => void;
      (prepareAppFoundation as jest.Mock).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );
      const starting = startServiceRuntime();
      const result = starting.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 0));
      (ForegroundService.getSessionId as jest.Mock).mockReturnValue(null);
      const cleanup = stopServiceRuntimeIfIdle();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const earlyStops = (longRunningTaskManager.stopAll as jest.Mock).mock.calls.length;
      if (owner === 'new-session')
        (ForegroundService.getSessionId as jest.Mock).mockReturnValue('new');
      if (owner === 'foreground') AppState.currentState = 'active';
      if (owner === 'rejected')
        (longRunningTaskManager.startAll as jest.Mock).mockRejectedValueOnce(
          new Error('init failed')
        );
      release();
      await Promise.all([result, cleanup]);
      expect(earlyStops).toBe(0);
      if (owner === 'idle' || owner === 'rejected') {
        expect(longRunningTaskManager.stopAll).toHaveBeenCalledTimes(1);
        expect(
          (longRunningTaskManager.stopAll as jest.Mock).mock.invocationCallOrder[0]
        ).toBeGreaterThan(
          (longRunningTaskManager.startAll as jest.Mock).mock.invocationCallOrder[0]
        );
      } else {
        expect(longRunningTaskManager.stopAll).not.toHaveBeenCalled();
      }
    }
  );

  it('initializes shared tasks on non-Android foregrounds and installs only once', async () => {
    const originalPlatform = Platform.OS;
    Platform.OS = 'ios';
    AppState.currentState = 'active';
    try {
      installServiceRuntime();
      expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
      await requestServiceRuntime(true);
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
      await requestServiceRuntime(true);
    } finally {
      Platform.OS = originalPlatform;
    }
  });
});

describe('Headless controlled shutdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    AppState.currentState = 'active';
    (ForegroundService.getSessionId as jest.Mock).mockReturnValue('control-1');
    (ForegroundService.getStopReason as jest.Mock).mockReturnValue(null);
    (configService.updateModule as jest.Mock).mockResolvedValue({ enableBackgroundTasks: false });
    (longRunningTaskManager.stopAll as jest.Mock).mockResolvedValue(undefined);
    (ForegroundService.finishHeadlessRuntime as jest.Mock).mockResolvedValue(undefined);
  });

  it('lets Headless persist stop, clean tasks, then finish its own session even with UI active', async () => {
    await stopServiceRuntime('control-1', 'stop');
    expect(backgroundRuntimeState.setTempDisabled).toHaveBeenCalledWith(true);
    expect(configService.updateModule).toHaveBeenCalledWith('background', {
      enableBackgroundTasks: false,
    });
    expect(longRunningTaskManager.stopAll).toHaveBeenCalledTimes(1);
    expect(ForegroundService.finishHeadlessRuntime).toHaveBeenCalledWith('control-1');
    expect((longRunningTaskManager.stopAll as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (ForegroundService.finishHeadlessRuntime as jest.Mock).mock.invocationCallOrder[0]
    );
    expect(ForegroundService.clearStopReason).not.toHaveBeenCalled();
  });

  it('temporary stop leaves background preference unchanged and deduplicates cleanup', async () => {
    const first = stopServiceRuntime('control-1', 'temporary');
    const second = stopServiceRuntime('control-1', 'temporary');
    expect(first).toBe(second);
    await first;
    expect(configService.updateModule).not.toHaveBeenCalled();
    expect(longRunningTaskManager.stopAll).toHaveBeenCalledTimes(1);
  });

  it('does not let an old Headless command stop its replacement', async () => {
    await stopServiceRuntime('old-control', 'stop');
    expect(backgroundRuntimeState.setTempDisabled).not.toHaveBeenCalled();
    expect(longRunningTaskManager.stopAll).not.toHaveBeenCalled();
    expect(ForegroundService.finishHeadlessRuntime).not.toHaveBeenCalled();
  });

  it('cleans tasks and ends the session even when saving the preference fails', async () => {
    (configService.updateModule as jest.Mock).mockRejectedValueOnce(new Error('disk failed'));
    await expect(stopServiceRuntime('control-1', 'stop')).rejects.toThrow('disk failed');
    expect(longRunningTaskManager.stopAll).toHaveBeenCalledTimes(1);
    expect(ForegroundService.finishHeadlessRuntime).toHaveBeenCalledWith('control-1');
  });

  it('does not lose a permanent stop arriving while temporary cleanup is running', async () => {
    (longRunningTaskManager.stopAll as jest.Mock).mockImplementationOnce(async () => {
      (ForegroundService.getStopReason as jest.Mock).mockReturnValue('stop');
    });
    await stopServiceRuntime('control-1', 'temporary');
    expect(configService.updateModule).toHaveBeenCalledWith('background', {
      enableBackgroundTasks: false,
    });
  });

  it('waits for controlled shutdown before an explicit foreground request can resume', async () => {
    let release!: () => void;
    (longRunningTaskManager.stopAll as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    (ForegroundService.getStopReason as jest.Mock).mockReturnValue('temporary');
    (ForegroundService.clearStopReason as jest.Mock).mockImplementation(() => {
      (ForegroundService.getStopReason as jest.Mock).mockReturnValue(null);
    });
    (ForegroundService.startHeadlessRuntime as jest.Mock).mockImplementation(async () => {
      (ForegroundService.getSessionId as jest.Mock).mockReturnValue('control-next');
      await headlessRuntimeInitialization.initialize('control-next', async () => {});
      return 'control-next';
    });
    const stopped = stopServiceRuntime('control-1', 'temporary');
    const resumed = requestServiceRuntime(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ForegroundService.clearStopReason).not.toHaveBeenCalled();
    expect(ForegroundService.startHeadlessRuntime).not.toHaveBeenCalled();
    release();
    await Promise.all([stopped, resumed]);
    expect(ForegroundService.startHeadlessRuntime).toHaveBeenCalledTimes(1);
    expect(
      (ForegroundService.finishHeadlessRuntime as jest.Mock).mock.invocationCallOrder[0]
    ).toBeLessThan(
      (ForegroundService.startHeadlessRuntime as jest.Mock).mock.invocationCallOrder[0]
    );
    headlessRuntimeInitialization.end('control-next');
  });
});
