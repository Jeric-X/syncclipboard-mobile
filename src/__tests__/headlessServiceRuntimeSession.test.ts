import {
  runHeadlessServiceRuntimeSession,
  type HeadlessServiceRuntimeSessionDependencies,
} from '../services/headless/headlessServiceRuntimeSession';

function setup() {
  let active = 'session-1';
  let listener: (id: string) => void = () => {};
  const unsubscribe = jest.fn();
  const releaseOverlay = jest.fn(async () => {});
  const deps: HeadlessServiceRuntimeSessionDependencies = {
    subscribeStopped: jest.fn((callback) => {
      listener = callback;
      return unsubscribe;
    }),
    isActive: (id) => active === id,
    initialize: jest.fn(async () => {}),
    acquireKeepAliveOverlay: jest.fn(() => releaseOverlay),
    markReady: jest.fn(),
    finishSession: jest.fn(async (id) => {
      if (active === id) active = '';
    }),
    shutdownIfIdle: jest.fn(async () => {}),
  };
  return {
    deps,
    unsubscribe,
    releaseOverlay,
    stop: (id = 'session-1') => {
      if (active === id) active = '';
      listener(id);
    },
  };
}

describe('Headless sync session', () => {
  it('keeps the task alive after initialization until its own service stops', async () => {
    const { deps, stop, unsubscribe, releaseOverlay } = setup();
    let finished = false;
    const task = runHeadlessServiceRuntimeSession('session-1', deps).then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(deps.markReady).toHaveBeenCalledWith('session-1');
    stop('sms-task');
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(releaseOverlay).not.toHaveBeenCalled();
    stop();
    await task;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(releaseOverlay).toHaveBeenCalledTimes(1);
    expect(deps.shutdownIfIdle).toHaveBeenCalledTimes(1);
  });

  it('clears native ownership before checking whether failed initialization left an idle runtime', async () => {
    const { deps } = setup();
    deps.initialize = jest.fn(async () => {
      throw new Error('startup failed');
    });
    deps.shutdownIfIdle = jest.fn(async () => {
      expect(deps.isActive('session-1')).toBe(false);
    });
    await expect(runHeadlessServiceRuntimeSession('session-1', deps)).rejects.toThrow(
      'startup failed'
    );
    expect(deps.finishSession).toHaveBeenCalledWith('session-1');
    expect(deps.shutdownIfIdle).toHaveBeenCalledTimes(1);
  });

  it('does not lose a stop request during asynchronous initialization', async () => {
    const { deps, stop, releaseOverlay } = setup();
    let initialized!: () => void;
    deps.initialize = jest.fn(() => new Promise<void>((resolve) => (initialized = resolve)));
    const task = runHeadlessServiceRuntimeSession('session-1', deps);
    stop();
    initialized();
    await task;
    expect(deps.markReady).not.toHaveBeenCalled();
    expect(releaseOverlay).toHaveBeenCalledTimes(1);
    expect(deps.shutdownIfIdle).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale task delivered after the service was destroyed', async () => {
    const { deps, stop } = setup();
    stop();
    await runHeadlessServiceRuntimeSession('session-1', deps);
    expect(deps.initialize).not.toHaveBeenCalled();
    expect(deps.acquireKeepAliveOverlay).not.toHaveBeenCalled();
  });

  it('releases listeners and runtime ownership if startup fails', async () => {
    const { deps, unsubscribe, releaseOverlay } = setup();
    deps.initialize = jest.fn(async () => {
      throw new Error('Cannot initialize');
    });
    await expect(runHeadlessServiceRuntimeSession('session-1', deps)).rejects.toThrow(
      'Cannot initialize'
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(releaseOverlay).toHaveBeenCalledTimes(1);
    expect(deps.shutdownIfIdle).toHaveBeenCalledTimes(1);
  });
});

describe('Headless user control', () => {
  it('handles controls received before initialization without starting tasks', async () => {
    const { deps } = setup();
    const controlled = {
      ...deps,
      subscribeControl: jest.fn(() => () => {}),
      getPendingControl: () => 'stop',
      stopFromControl: jest.fn(async () => {}),
    };
    const task = runHeadlessServiceRuntimeSession('session-1', controlled);
    await Promise.resolve();
    expect(controlled.stopFromControl).toHaveBeenCalledWith('stop');
    await task;
    expect(deps.initialize).not.toHaveBeenCalled();
    expect(deps.markReady).not.toHaveBeenCalled();
  });

  it('forwards controls during initialization immediately and waits for cleanup', async () => {
    const { deps } = setup();
    let control!: (reason: string) => void;
    let initialized!: () => void;
    let cleaned!: () => void;
    deps.initialize = () =>
      new Promise<void>((resolve) => {
        initialized = resolve;
      });
    const unsubscribe = jest.fn();
    const controlled = {
      ...deps,
      subscribeControl: (listener: (reason: string) => void) => {
        control = listener;
        return unsubscribe;
      },
      getPendingControl: () => null,
      stopFromControl: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            cleaned = resolve;
          })
      ),
    };
    const task = runHeadlessServiceRuntimeSession('session-1', controlled);
    expect(control).toBeDefined();
    control('temporary');
    expect(controlled.stopFromControl).toHaveBeenCalledWith('temporary');
    initialized();
    await Promise.resolve();
    expect(deps.finishSession).not.toHaveBeenCalled();
    expect(deps.markReady).not.toHaveBeenCalled();
    cleaned();
    await task;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('treats readiness cancellation from a user stop as normal completion', async () => {
    const { deps } = setup();
    let control!: (reason: string) => void;
    let rejectInitialization!: (error: Error) => void;
    deps.initialize = () =>
      new Promise<void>((_resolve, reject) => {
        rejectInitialization = reject;
      });
    const controlled = {
      ...deps,
      subscribeControl: (listener: (reason: string) => void) => {
        control = listener;
        return () => {};
      },
      getPendingControl: () => null,
      stopFromControl: jest.fn(async () => {}),
    };
    const task = runHeadlessServiceRuntimeSession('session-1', controlled);
    control('temporary');
    rejectInitialization(new Error('Headless session ended before initialization'));
    await expect(task).resolves.toBeUndefined();
    expect(deps.markReady).not.toHaveBeenCalled();
    expect(deps.finishSession).toHaveBeenCalledTimes(1);
  });
});
