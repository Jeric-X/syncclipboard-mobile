import {
  runHeadlessServiceRuntimeSession,
  type HeadlessServiceRuntimeSessionDependencies,
} from '../utils/headlessServiceRuntimeSession';

function setup() {
  let active = 'session-1';
  let listener: (id: string) => void = () => {};
  const unsubscribe = jest.fn();
  const deps: HeadlessServiceRuntimeSessionDependencies = {
    subscribeStopped: jest.fn((callback) => {
      listener = callback;
      return unsubscribe;
    }),
    isActive: (id) => active === id,
    initialize: jest.fn(async () => {}),
    markReady: jest.fn(),
    shutdownIfIdle: jest.fn(async () => {}),
  };
  return {
    deps,
    unsubscribe,
    stop: (id = 'session-1') => {
      if (active === id) active = '';
      listener(id);
    },
  };
}

describe('Headless sync session', () => {
  it('keeps the task alive after initialization until its own service stops', async () => {
    const { deps, stop, unsubscribe } = setup();
    let finished = false;
    const task = runHeadlessServiceRuntimeSession('session-1', deps).then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(deps.markReady).toHaveBeenCalledWith('session-1');
    stop('sms-task');
    await Promise.resolve();
    expect(finished).toBe(false);
    stop();
    await task;
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(deps.shutdownIfIdle).toHaveBeenCalledTimes(1);
  });

  it('does not lose a stop request during asynchronous initialization', async () => {
    const { deps, stop } = setup();
    let initialized!: () => void;
    deps.initialize = jest.fn(() => new Promise<void>((resolve) => (initialized = resolve)));
    const task = runHeadlessServiceRuntimeSession('session-1', deps);
    stop();
    initialized();
    await task;
    expect(deps.markReady).not.toHaveBeenCalled();
    expect(deps.shutdownIfIdle).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale task delivered after the service was destroyed', async () => {
    const { deps, stop } = setup();
    stop();
    await runHeadlessServiceRuntimeSession('session-1', deps);
    expect(deps.initialize).not.toHaveBeenCalled();
  });

  it('releases listeners and runtime ownership if startup fails', async () => {
    const { deps, unsubscribe } = setup();
    deps.initialize = jest.fn(async () => {
      throw new Error('Cannot initialize');
    });
    await expect(runHeadlessServiceRuntimeSession('session-1', deps)).rejects.toThrow(
      'Cannot initialize'
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(deps.shutdownIfIdle).toHaveBeenCalledTimes(1);
  });
});
