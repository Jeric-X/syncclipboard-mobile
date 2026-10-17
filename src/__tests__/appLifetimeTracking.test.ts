import { createAppLifetimeTracking } from '../services/statistics/appLifetimeTracking';

function setup(debugMode = true) {
  let debugModeChanged!: (enabled: boolean) => void;
  let tick!: () => void;
  let appStateChanged!: () => void;
  const deps = {
    startedAt: '2026-10-17T01:00:00.000Z',
    now: jest.fn(() => '2026-10-17T01:02:00.000Z'),
    loadDebugMode: jest.fn(async () => debugMode),
    subscribeDebugMode: jest.fn((callback: (enabled: boolean) => void) => {
      debugModeChanged = callback;
    }),
    stopRecording: jest.fn(async () => {}),
    clearTimer: jest.fn(),
    recordAppStart: jest.fn(async (_startedAt: string) => {}),
    updateHeartbeat: jest.fn(async () => {}),
    setTimer: jest.fn((callback: () => void, _interval: number) => {
      tick = callback;
      return 'statistics-timer';
    }),
    subscribeAppState: jest.fn((callback: () => void) => {
      appStateChanged = callback;
    }),
    onError: jest.fn(),
  };
  return {
    deps,
    debugModeChanged: (enabled: boolean) => debugModeChanged(enabled),
    install: createAppLifetimeTracking(deps),
    tick: () => tick(),
    appStateChanged: () => appStateChanged(),
  };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

it('starts without a foreground event (headless), installs once and continues across app state changes', async () => {
  const { deps, install, tick, appStateChanged } = setup();
  install();
  install();
  await flush();
  expect(deps.recordAppStart).toHaveBeenCalledWith(deps.startedAt);
  expect(deps.updateHeartbeat).toHaveBeenCalledTimes(1);
  expect(deps.setTimer).toHaveBeenCalledTimes(1);
  expect(deps.setTimer).toHaveBeenCalledWith(expect.any(Function), 5_000);
  expect(deps.subscribeAppState).toHaveBeenCalledTimes(1);
  appStateChanged();
  await flush();
  tick();
  await flush();
  appStateChanged();
  await flush();
  tick();
  await flush();
  expect(deps.updateHeartbeat).toHaveBeenCalledTimes(5);
});

it('retries failed startup on the next tick using the original start time', async () => {
  const { deps, install, tick } = setup();
  deps.recordAppStart.mockRejectedValueOnce(new Error('disk busy'));
  install();
  await flush();
  expect(deps.onError).toHaveBeenCalledTimes(1);
  expect(deps.updateHeartbeat).not.toHaveBeenCalled();
  tick();
  await flush();
  expect(deps.recordAppStart).toHaveBeenLastCalledWith(deps.startedAt);
  expect(deps.updateHeartbeat).toHaveBeenCalledTimes(1);
});

it('does not build a heartbeat backlog while storage is slow', async () => {
  const { deps, install, tick, appStateChanged } = setup();
  let finish!: () => void;
  deps.updateHeartbeat.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  install();
  await flush();
  tick();
  tick();
  appStateChanged();
  expect(deps.updateHeartbeat).toHaveBeenCalledTimes(1);
  finish();
  await flush();
  tick();
  await flush();
  expect(deps.updateHeartbeat).toHaveBeenCalledTimes(2);
});

it('does not record or install a timer with debug mode disabled, including on app state changes', async () => {
  const { deps, install, appStateChanged } = setup(false);
  install();
  await flush();
  appStateChanged();
  await flush();
  expect(deps.setTimer).not.toHaveBeenCalled();
  expect(deps.recordAppStart).not.toHaveBeenCalled();
  expect(deps.updateHeartbeat).not.toHaveBeenCalled();
});

it('starts from enable time and stops immediately on disable, ignoring late timer events', async () => {
  const { deps, install, debugModeChanged, tick, appStateChanged } = setup(false);
  install();
  await flush();
  debugModeChanged(true);
  await flush();
  expect(deps.recordAppStart).toHaveBeenLastCalledWith(deps.now());
  expect(deps.updateHeartbeat).toHaveBeenCalledTimes(1);
  debugModeChanged(true); // unrelated config updates do not restart tracking
  expect(deps.setTimer).toHaveBeenCalledTimes(1);
  debugModeChanged(false);
  tick();
  appStateChanged();
  await flush();
  expect(deps.clearTimer).toHaveBeenCalledWith('statistics-timer');
  expect(deps.stopRecording).toHaveBeenCalledTimes(1);
  expect(deps.updateHeartbeat).toHaveBeenCalledTimes(1);
  deps.now.mockReturnValue('2026-10-17T02:00:00.000Z');
  debugModeChanged(true);
  await flush();
  expect(deps.recordAppStart).toHaveBeenLastCalledWith('2026-10-17T02:00:00.000Z');
  expect(deps.setTimer).toHaveBeenCalledTimes(2);
});

it('ignores a stale enabled startup config after a newer disabled notification', async () => {
  const { deps, install, debugModeChanged } = setup();
  let resolveConfig!: (enabled: boolean) => void;
  deps.loadDebugMode.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveConfig = resolve;
      })
  );
  install();
  debugModeChanged(false);
  resolveConfig(true);
  await flush();
  expect(deps.recordAppStart).not.toHaveBeenCalled();
  expect(deps.setTimer).not.toHaveBeenCalled();
});

it('serializes stop and restart after an in-flight start without recording a disabled interval', async () => {
  const { deps, install, debugModeChanged } = setup();
  let finishStart!: () => void;
  deps.recordAppStart.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishStart = resolve;
      })
  );
  install();
  await flush();
  debugModeChanged(false);
  debugModeChanged(true);
  finishStart();
  await flush();
  expect(deps.recordAppStart).toHaveBeenCalledTimes(2);
  expect(deps.stopRecording).toHaveBeenCalledTimes(1);
  expect(deps.updateHeartbeat).toHaveBeenCalledTimes(1);
  expect(deps.stopRecording.mock.invocationCallOrder[0]).toBeLessThan(
    deps.recordAppStart.mock.invocationCallOrder[1]
  );
  expect(deps.recordAppStart).toHaveBeenLastCalledWith(deps.now());
});
