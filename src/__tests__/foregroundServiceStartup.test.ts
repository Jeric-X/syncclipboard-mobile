import { ForegroundServiceStartup } from '../utils/foregroundServiceStartup';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  let running = false;
  let allowed = true;
  const release = jest.fn(async () => {});
  const deps = {
    isRunning: () => running,
    start: jest.fn(() => true),
    shouldRun: jest.fn(async () => allowed),
    sleep: jest.fn(async (_milliseconds: number, _signal: AbortSignal) => {}),
    acquireOverlay: jest.fn(async (): Promise<(() => Promise<void>) | null> => release),
  };
  return {
    deps,
    release,
    startup: new ForegroundServiceStartup(deps),
    setRunning: (value: boolean) => {
      running = value;
    },
    setAllowed: (value: boolean) => {
      allowed = value;
    },
  };
}

test('an already running service is reused without a startup cycle', async () => {
  const { startup, deps, setRunning } = setup();
  setRunning(true);
  expect(await startup.start()).toBe(true);
  expect(deps.start).not.toHaveBeenCalled();
  expect(deps.acquireOverlay).not.toHaveBeenCalled();
});

test('concurrent requests share one attempt and confirm actual running state', async () => {
  const { startup, deps, setRunning } = setup();
  const wait = deferred<void>();
  deps.sleep.mockImplementationOnce(() => wait.promise);
  const first = startup.start();
  expect(startup.start()).toBe(first);
  await Promise.resolve();
  await Promise.resolve();
  expect(deps.start).toHaveBeenCalledTimes(1);
  setRunning(true);
  wait.resolve();
  expect(await first).toBe(true);
  expect(deps.acquireOverlay).not.toHaveBeenCalled();
});

test('a rejected first start waits, awaits window creation, then waits another second before retry', async () => {
  const { startup, deps, release, setRunning } = setup();
  const events: string[] = [];
  const overlay = deferred<() => Promise<void>>();
  const creating = deferred<void>();
  deps.start.mockImplementationOnce(() => {
    events.push('rejected');
    throw new Error('not allowed');
  });
  deps.start.mockImplementationOnce(() => {
    events.push('retry');
    setRunning(true);
    return true;
  });
  deps.sleep.mockImplementation(async (ms) => {
    events.push(`wait ${ms}`);
  });
  deps.acquireOverlay.mockImplementation(async () => {
    events.push('create');
    creating.resolve();
    const result = await overlay.promise;
    events.push('created');
    return result;
  });
  const result = startup.start();
  await creating.promise;
  expect(events).toEqual(['rejected', 'wait 1000', 'create']);
  overlay.resolve(release);
  expect(await result).toBe(true);
  expect(events).toEqual(['rejected', 'wait 1000', 'create', 'created', 'wait 1000', 'retry']);
  expect(release).toHaveBeenCalledTimes(1);
});

test('late success during the overlay delay avoids a second request', async () => {
  const { startup, deps, release, setRunning } = setup();
  deps.sleep
    .mockImplementationOnce(async () => {})
    .mockImplementationOnce(async () => {
      setRunning(true);
    });
  expect(await startup.start()).toBe(true);
  expect(deps.start).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
});

test('accepted requests are not success; failure is bounded to two attempts with cleanup', async () => {
  const { startup, deps, release } = setup();
  expect(await startup.start()).toBe(false);
  expect(deps.start).toHaveBeenCalledTimes(2);
  expect(deps.sleep).toHaveBeenCalledTimes(3);
  expect(release).toHaveBeenCalledTimes(1);
});

test('no permission or failed creation does not retry without a window', async () => {
  const { startup, deps } = setup();
  deps.acquireOverlay.mockResolvedValue(null);
  expect(await startup.start()).toBe(false);
  expect(deps.start).toHaveBeenCalledTimes(1);
  expect(deps.sleep).toHaveBeenCalledTimes(1);
});

test('late native success is recognized even when overlay acquisition returns null', async () => {
  const { startup, deps, setRunning } = setup();
  deps.acquireOverlay.mockImplementationOnce(async () => {
    setRunning(true);
    return null;
  });
  expect(await startup.start()).toBe(true);
  expect(deps.start).toHaveBeenCalledTimes(1);
  expect(deps.sleep).toHaveBeenCalledTimes(1);
});

test('cancellation still wins over late native success with an unavailable overlay', async () => {
  const { startup, deps, setRunning } = setup();
  deps.acquireOverlay.mockImplementationOnce(async () => {
    setRunning(true);
    startup.cancel();
    return null;
  });
  expect(await startup.start()).toBe(false);
  expect(deps.start).toHaveBeenCalledTimes(1);
});

test('stop during window creation releases the eventual window without retrying', async () => {
  const { startup, deps, release } = setup();
  deps.acquireOverlay.mockImplementationOnce(async () => {
    startup.cancel();
    return release;
  });
  expect(await startup.start()).toBe(false);
  expect(deps.start).toHaveBeenCalledTimes(1);
  expect(deps.sleep).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
});

test('stop during the second wait prevents retry even if settings are enabled again', async () => {
  const { startup, deps, release } = setup();
  deps.sleep
    .mockImplementationOnce(async () => {})
    .mockImplementationOnce(async () => {
      startup.cancel();
    });
  expect(await startup.start()).toBe(false);
  expect(deps.start).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
});

test('configuration is rechecked after waits and before using the overlay', async () => {
  const { startup, deps, setAllowed } = setup();
  deps.sleep.mockImplementationOnce(async () => {
    setAllowed(false);
  });
  expect(await startup.start()).toBe(false);
  expect(deps.acquireOverlay).not.toHaveBeenCalled();
});

test('a subsequent independent request can succeed after an earlier cancellation', async () => {
  const { startup, deps, setRunning } = setup();
  deps.sleep.mockImplementationOnce(async () => {
    startup.cancel();
  });
  expect(await startup.start()).toBe(false);
  deps.start.mockImplementationOnce(() => {
    setRunning(true);
    return true;
  });
  expect(await startup.start()).toBe(true);
  expect(deps.start).toHaveBeenCalledTimes(2);
});

test.each(['running', 'cancelled', 'disabled', 'stopped'] as const)(
  'overlay acquisition rejection rechecks native state and policy: %s',
  async (state) => {
    const { startup, deps, setRunning, setAllowed } = setup();
    deps.acquireOverlay.mockImplementationOnce(async () => {
      setRunning(state !== 'stopped');
      if (state === 'cancelled') startup.cancel();
      if (state === 'disabled') setAllowed(false);
      throw new Error('native overlay show failed');
    });
    await expect(startup.start()).resolves.toBe(state === 'running');
    expect(deps.start).toHaveBeenCalledTimes(1);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  }
);
