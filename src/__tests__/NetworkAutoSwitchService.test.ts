jest.mock('native-util', () => ({
  showNotification: jest.fn(),
  getCurrentNetworkInfo: jest.fn(),
}));
jest.mock('native-timer', () => {
  const timers = new Map<string, ReturnType<typeof setInterval>>();
  return {
    setTimer: (callback: () => void, intervalMs: number, tag: string) => {
      const existing = timers.get(tag);
      if (existing) clearInterval(existing);
      timers.set(tag, setInterval(callback, intervalMs));
      return tag;
    },
    clearTimer: (tag: string) => {
      const timer = timers.get(tag);
      if (timer) clearInterval(timer);
      timers.delete(tag);
    },
  };
});
jest.mock('../services/CurrentNetworkService', () => ({
  currentNetworkService: {
    getSnapshot: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
  },
}));
jest.mock('../services/ConfigService', () => ({
  configService: {
    getConfig: jest.fn(),
    setActiveServerById: jest.fn(),
  },
}));
jest.mock('../services/history/HistorySyncService', () => ({
  getHistorySyncService: () => ({ cancelAll: jest.fn() }),
}));

import { NetworkAutoSwitchService } from '../services/NetworkAutoSwitchService';
import type { NetworkAutoSwitchDependencies } from '../services/NetworkAutoSwitchService';
import { DEFAULT_APP_CONFIG, type AppConfig } from '../types/storage';
import type { MobileNetworkSnapshot } from '../types/networkAutoSwitch';

const wifi: MobileNetworkSnapshot = {
  isConnected: true,
  isInternetReachable: true,
  type: 'wifi',
  ssid: 'Home',
  ipAddresses: ['192.168.1.20'],
  capturedAt: 100,
  unavailableReasons: [],
};

function createConfig(activeServerIndex = 1): AppConfig {
  return {
    ...DEFAULT_APP_CONFIG,
    servers: [
      { id: 'home', name: 'Home', type: 'syncclipboard', url: 'http://home' },
      { id: 'public', name: 'Public', type: 'syncclipboard', url: 'https://public' },
    ],
    activeServerIndex,
    networkAutoSwitch: {
      enabled: true,
      notificationMode: 'system',
      noMatchAction: 'keep',
      rules: [
        {
          id: 'home-rule',
          name: 'Home Wi-Fi',
          enabled: true,
          targetServerId: 'home',
          networkTypes: [],
          ssids: ['Home'],
          ipRanges: [],
          matchMode: 'all',
        },
      ],
    },
  };
}

function harness(initial = createConfig()) {
  let config = initial;
  let snapshot = wifi;
  let networkListener: (() => void) | null = null;
  const notify = jest.fn();
  const unsubscribe = jest.fn();
  const switchServer = jest.fn(async (serverId: string | null) => {
    config = {
      ...config,
      activeServerIndex:
        serverId === null ? -1 : config.servers.findIndex((server) => server.id === serverId),
    };
    return config;
  });
  const deps: NetworkAutoSwitchDependencies = {
    getConfig: jest.fn(async () => config),
    switchServer,
    getSnapshot: jest.fn(async () => snapshot),
    subscribeNetwork: jest.fn((listener) => {
      networkListener = listener;
      return unsubscribe;
    }),
    notify,
  };
  const service = new NetworkAutoSwitchService(deps);
  return {
    service,
    deps,
    notify,
    switchServer,
    unsubscribe,
    getConfig: () => config,
    setConfig: (next: AppConfig) => {
      config = next;
    },
    setSnapshot: (next: MobileNetworkSnapshot) => {
      snapshot = next;
    },
    emitNetwork: () => networkListener?.(),
  };
}

describe('NetworkAutoSwitchService', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('启动时按当前网络切换，并仅在实际变化时通知', async () => {
    const h = harness();
    await h.service.start();
    expect(h.switchServer).toHaveBeenCalledWith('home');
    expect(h.notify).toHaveBeenCalledWith('Home Wi-Fi → Home', 'system');
    expect(h.service.getState()).toMatchObject({
      phase: 'matched',
      activeServerId: 'home',
      manualOverride: false,
    });

    await h.service.refresh();
    expect(h.switchServer).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('并发启动与同步前检查共享同一次初始化', async () => {
    const h = harness();
    let resolveInitialConfig: ((config: AppConfig) => void) | undefined;
    const initialConfig = new Promise<AppConfig>((resolve) => {
      resolveInitialConfig = resolve;
    });
    const getConfig = h.deps.getConfig as jest.MockedFunction<typeof h.deps.getConfig>;
    getConfig
      .mockImplementationOnce(() => initialConfig)
      .mockImplementation(async () => h.getConfig());

    const startup = h.service.start();
    const preflight = h.service.ensureCurrentServer();
    resolveInitialConfig?.(h.getConfig());
    await Promise.all([startup, preflight]);

    expect(h.deps.getSnapshot).toHaveBeenCalledTimes(1);
    expect(h.switchServer).toHaveBeenCalledTimes(1);
  });

  it('按配置选择 Toast 通知方式', async () => {
    const initial = createConfig();
    const h = harness({
      ...initial,
      networkAutoSwitch: { ...initial.networkAutoSwitch, notificationMode: 'toast' },
    });
    await h.service.start();
    expect(h.notify).toHaveBeenCalledWith('Home Wi-Fi → Home', 'toast');
  });

  it('选择不通知时仍切换服务器但不发送提示', async () => {
    const initial = createConfig();
    const h = harness({
      ...initial,
      networkAutoSwitch: { ...initial.networkAutoSwitch, notificationMode: 'none' },
    });
    await h.service.start();
    expect(h.switchServer).toHaveBeenCalledWith('home');
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('断网时保持当前服务器，不执行无匹配动作', async () => {
    const h = harness({
      ...createConfig(),
      networkAutoSwitch: {
        ...createConfig().networkAutoSwitch,
        noMatchAction: 'none',
      },
    });
    h.setSnapshot({ ...wifi, isConnected: false, type: 'none' });
    await h.service.start();
    expect(h.switchServer).not.toHaveBeenCalled();
    expect(h.service.getState().phase).toBe('waiting');
  });

  it('连续网络事件只应用最后一份稳定快照', async () => {
    jest.useFakeTimers();
    const h = harness(createConfig(0));
    await h.service.start();
    h.setSnapshot({ ...wifi, ssid: 'Office', type: 'cellular' });
    h.emitNetwork();
    h.setSnapshot({ ...wifi, ssid: 'Home' });
    h.emitNetwork();
    expect(h.switchServer).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(999);
    expect(h.switchServer).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(h.service.getState().evaluation?.reason).toBe('matched-rule');
  });

  it('稳定网络下同步前不重复读取快照，仅在网络变脏时重新评估', async () => {
    const h = harness(createConfig(0));
    await h.service.start();
    expect(h.deps.getSnapshot).toHaveBeenCalledTimes(1);

    await h.service.ensureCurrentServer();
    expect(h.deps.getSnapshot).toHaveBeenCalledTimes(1);

    h.emitNetwork();
    await h.service.ensureCurrentServer();
    expect(h.deps.getSnapshot).toHaveBeenCalledTimes(2);
    await h.service.stop();
  });

  it('手动选择取消待执行防抖，相同网络不会自动切回', async () => {
    jest.useFakeTimers();
    const h = harness(createConfig(0));
    await h.service.start();
    h.emitNetwork();
    h.service.beginManualOverride();
    h.setConfig({ ...h.getConfig(), activeServerIndex: 1 });
    await jest.advanceTimersByTimeAsync(2500);
    expect(h.switchServer).not.toHaveBeenCalled();
    await h.service.refresh();
    expect(h.switchServer).not.toHaveBeenCalled();
    expect(h.service.getState().phase).toBe('manual-override');

    h.setSnapshot({ ...wifi, ssid: 'Other', type: 'cellular' });
    h.emitNetwork();
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    expect(h.service.getState().manualOverride).toBe(false);
  });

  it('防抖期网络已变化时，手动选择绑定下次获取的新快照', async () => {
    jest.useFakeTimers();
    const h = harness(createConfig(0));
    await h.service.start();

    h.setSnapshot({ ...wifi, ipAddresses: ['192.168.1.21'], capturedAt: 200 });
    h.emitNetwork();
    h.service.beginManualOverride();
    h.setConfig({ ...h.getConfig(), activeServerIndex: 1 });

    await h.service.refresh();
    expect(h.switchServer).not.toHaveBeenCalled();
    expect(h.service.getState()).toMatchObject({
      phase: 'manual-override',
      activeServerId: 'public',
      manualOverride: true,
    });

    await jest.advanceTimersByTimeAsync(1000);
    expect(h.switchServer).not.toHaveBeenCalled();
  });

  it('规则配置变化清除手动覆盖并立即重新评估', async () => {
    const h = harness(createConfig(0));
    await h.service.start();
    h.service.beginManualOverride();
    h.setConfig({
      ...h.getConfig(),
      networkAutoSwitch: {
        ...h.getConfig().networkAutoSwitch,
        rules: [{ ...h.getConfig().networkAutoSwitch.rules[0], name: 'Updated' }],
      },
    });
    await h.service.onConfigChanged();
    expect(h.service.getState().manualOverride).toBe(false);
    expect(h.service.getState().evaluation?.matchedRuleName).toBe('Updated');
  });

  it('关闭功能后解除网络监听且不切换', async () => {
    const h = harness(createConfig(0));
    await h.service.start();
    h.setConfig({
      ...h.getConfig(),
      networkAutoSwitch: { ...h.getConfig().networkAutoSwitch, enabled: false },
    });
    await h.service.onConfigChanged();
    expect(h.unsubscribe).toHaveBeenCalled();
    expect(h.service.getState().phase).toBe('disabled');
  });

  it('读取或切换失败时保留错误状态', async () => {
    const h = harness();
    (h.deps.getSnapshot as jest.Mock).mockRejectedValueOnce(new Error('network unavailable'));
    await h.service.start();
    expect(h.switchServer).not.toHaveBeenCalled();
    expect(h.service.getState()).toMatchObject({ phase: 'error', error: 'network unavailable' });
  });

  it('停止后取消订阅且不响应网络事件', async () => {
    const h = harness(createConfig(0));
    await h.service.start();
    await h.service.stop();
    h.emitNetwork();
    expect(h.unsubscribe).toHaveBeenCalled();
    expect(h.switchServer).not.toHaveBeenCalled();
  });
});
