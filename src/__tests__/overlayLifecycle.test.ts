import { OverlayLifecycle, type OverlayConfig } from '../utils/overlayLifecycle';

function setup() {
  let showing = false;
  let permission = true;
  let idle: (() => void) | undefined;
  const deps = {
    hasPermission: () => permission,
    isShowing: () => showing,
    show: jest.fn(async () => {
      showing = true;
      return true;
    }),
    hide: jest.fn(async () => {
      showing = false;
      return true;
    }),
    setDebugMode: jest.fn(),
    setMaxRetries: jest.fn(),
    scheduleIdle: jest.fn((callback: () => void) => {
      idle = callback;
    }),
    cancelIdle: jest.fn(() => {
      idle = undefined;
    }),
    onError: jest.fn(),
  };
  const lifecycle = new OverlayLifecycle(deps);
  const config: OverlayConfig = {
    enableClipboardOverlay: true,
    enableOverlayKeepAlive: true,
    debugMode: false,
    debugOverlayVisible: false,
  };
  return {
    lifecycle,
    deps,
    config,
    showing: () => showing,
    setPermission: (value: boolean) => {
      permission = value;
    },
    expire: async () => {
      idle?.();
      await lifecycle.updateConfig(config);
    },
  };
}

test('clipboard timeout and foreground transition preserve a headless keep-alive window', async () => {
  const { lifecycle, deps, config, expire, showing } = setup();
  await lifecycle.updateConfig(config);
  const stop = lifecycle.acquireKeepAlive();
  const release = await lifecycle.acquireClipboard();
  await release!();
  await expire();
  expect(showing()).toBe(true);
  await lifecycle.setForeground(true);
  expect(showing()).toBe(true);
  expect(deps.show).toHaveBeenCalledTimes(1);
  expect(deps.hide).not.toHaveBeenCalled();
  await stop();
  expect(showing()).toBe(false);
});

test('ending keep-alive preserves clipboard demand until its idle timeout', async () => {
  const { lifecycle, config, expire, showing } = setup();
  await lifecycle.updateConfig(config);
  const stop = lifecycle.acquireKeepAlive();
  const release = await lifecycle.acquireClipboard();
  await release!();
  await stop();
  expect(showing()).toBe(true);
  await expire();
  expect(showing()).toBe(false);
});

test('keep-alive toggle applies to an existing session without enabling clipboard reads', async () => {
  const { lifecycle, config, showing } = setup();
  config.enableClipboardOverlay = false;
  config.enableOverlayKeepAlive = false;
  await lifecycle.updateConfig({ ...config });
  const stop = lifecycle.acquireKeepAlive();
  await lifecycle.updateConfig({ ...config });
  expect(showing()).toBe(false);
  await lifecycle.updateConfig({ ...config, enableOverlayKeepAlive: true });
  expect(showing()).toBe(true);
  expect(await lifecycle.acquireClipboard()).toBeNull();
  await lifecycle.updateConfig(config);
  expect(showing()).toBe(false);
  await stop();
});

test('debug appearance changes immediately for a keep-alive-only window', async () => {
  const { lifecycle, config, deps, showing } = setup();
  config.enableClipboardOverlay = false;
  await lifecycle.updateConfig(config);
  const stop = lifecycle.acquireKeepAlive();
  await lifecycle.updateConfig({ ...config, debugMode: true, debugOverlayVisible: true });
  expect(showing()).toBe(true);
  expect(deps.setDebugMode).toHaveBeenLastCalledWith(true);
  await lifecycle.updateConfig({ ...config, debugMode: false, debugOverlayVisible: true });
  expect(deps.setDebugMode).toHaveBeenLastCalledWith(false);
  expect(deps.show).toHaveBeenCalledTimes(1);
  await stop();
});

test('debug visibility alone does not create a window', async () => {
  const { lifecycle, config, showing } = setup();
  await lifecycle.updateConfig({ ...config, debugMode: true, debugOverlayVisible: true });
  expect(showing()).toBe(false);
});

test('disabling both features waits for an in-flight clipboard read', async () => {
  const { lifecycle, config, showing } = setup();
  await lifecycle.updateConfig(config);
  const release = await lifecycle.acquireClipboard();
  await lifecycle.updateConfig({
    ...config,
    enableClipboardOverlay: false,
    enableOverlayKeepAlive: false,
  });
  expect(showing()).toBe(true);
  await release!();
  expect(showing()).toBe(false);
});

test('old sessions cannot release a newer session, and release is idempotent', async () => {
  const { lifecycle, config, showing } = setup();
  await lifecycle.updateConfig(config);
  const first = lifecycle.acquireKeepAlive();
  const second = lifecycle.acquireKeepAlive();
  await first();
  await first();
  expect(showing()).toBe(true);
  await second();
  expect(showing()).toBe(false);
});

test('missing permission does not create a window; permission can be retried on foreground', async () => {
  const { lifecycle, config, showing, setPermission } = setup();
  setPermission(false);
  await lifecycle.updateConfig(config);
  const stop = lifecycle.acquireKeepAlive();
  expect(await lifecycle.acquireClipboard()).toBeNull();
  expect(showing()).toBe(false);
  setPermission(true);
  await lifecycle.setForeground(true);
  expect(showing()).toBe(true);
  await stop();
});

test('a stop racing asynchronous window creation removes the window afterwards', async () => {
  const { lifecycle, config, deps, showing } = setup();
  await lifecycle.updateConfig(config);
  let finish!: () => void;
  const show = deps.show.getMockImplementation()!;
  deps.show.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return show();
  });
  const stop = lifecycle.acquireKeepAlive();
  await Promise.resolve();
  const stopped = stop();
  finish();
  await stopped;
  expect(showing()).toBe(false);
});

test('a failed native operation does not block later reconciliation', async () => {
  const { lifecycle, config, deps, showing } = setup();
  await lifecycle.updateConfig(config);
  deps.show.mockRejectedValueOnce(new Error('window unavailable'));
  const stop = lifecycle.acquireKeepAlive();
  await lifecycle.updateConfig(config);
  expect(deps.onError).toHaveBeenCalled();
  expect(showing()).toBe(true);
  await stop();
});

test('startup can temporarily borrow a window with both persistent options off', async () => {
  const { lifecycle, config, showing } = setup();
  await lifecycle.updateConfig({
    ...config,
    enableClipboardOverlay: false,
    enableOverlayKeepAlive: false,
  });
  const release = await lifecycle.acquireStartup();
  expect(showing()).toBe(true);
  expect(await lifecycle.acquireClipboard()).toBeNull();
  await lifecycle.setForeground(true);
  expect(showing()).toBe(true);
  await release!();
  expect(showing()).toBe(false);
});

test('startup release preserves clipboard and headless owners', async () => {
  const { lifecycle, config, showing, expire } = setup();
  await lifecycle.updateConfig(config);
  const headless = lifecycle.acquireKeepAlive();
  const clipboard = await lifecycle.acquireClipboard();
  const startup = await lifecycle.acquireStartup();
  await startup!();
  await startup!();
  expect(showing()).toBe(true);
  await headless();
  expect(showing()).toBe(true);
  await clipboard!();
  await expire();
  expect(showing()).toBe(false);
});

test('failed startup acquisition leaves no window demand behind', async () => {
  const { lifecycle, config, showing, deps } = setup();
  await lifecycle.updateConfig(config);
  deps.show.mockResolvedValueOnce(false);
  expect(await lifecycle.acquireStartup()).toBeNull();
  await lifecycle.updateConfig(config);
  expect(showing()).toBe(false);
  deps.show.mockRejectedValueOnce(new Error('cannot attach'));
  await expect(lifecycle.acquireStartup()).rejects.toThrow('cannot attach');
  await lifecycle.updateConfig(config);
  expect(showing()).toBe(false);
});
