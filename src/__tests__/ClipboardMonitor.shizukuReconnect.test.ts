import { ClipboardMonitor } from '../services/clipboard/ClipboardMonitor';
import type { LocalClipboard } from '../services/clipboard/LocalClipboard';
import { setTimer, clearTimer } from 'native-timer';
import { configService } from '../services/ConfigService';
import { requireNativeModule } from 'expo-modules-core';

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: { currentState: 'active' },
}));
jest.mock('native-timer', () => ({ setTimer: jest.fn(() => 'poll'), clearTimer: jest.fn() }));
jest.mock('../services/clipboard/LocalClipboard', () => ({
  localClipboard: { registerCopyLifecycleCallbacks: jest.fn() },
}));
jest.mock('../services/ConfigService', () => ({ configService: { getConfig: jest.fn() } }));
jest.mock('expo-modules-core', () => ({
  requireNativeModule: jest.fn(() => ({
    isShizukuAvailable: jest.fn(() => true),
    hasShizukuPermission: jest.fn(() => true),
    startPrimaryClipChangedListener: jest.fn(async () => true),
    stopPrimaryClipChangedListener: jest.fn(async () => {}),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  })),
}));
jest.mock('clipboard-overlay', () => ({}));
jest.mock('../services/overlay/OverlayManager', () => ({}));
jest.mock('../utils/startupTiming', () => ({
  logStartupPoint: jest.fn(),
  measureStartup: (_stage: string, action: () => unknown) => action(),
}));

const native = jest.mocked(requireNativeModule).mock.results[0].value;
let monitor: ClipboardMonitor;
let readClipboard: jest.Mock;
let events: Map<string, () => void>;

beforeEach(() => {
  jest.clearAllMocks();
  events = new Map();
  native.addListener.mockImplementation((name: string, callback: () => void) => {
    events.set(name, callback);
    return { remove: jest.fn(() => events.delete(name)) };
  });
  native.startPrimaryClipChangedListener.mockResolvedValue(true);
  native.isShizukuAvailable.mockReturnValue(true);
  native.hasShizukuPermission.mockReturnValue(true);
  jest.mocked(configService.getConfig).mockResolvedValue({
    enableShizukuClipboard: true,
    enableShizukuRecovery: false,
  } as Awaited<ReturnType<typeof configService.getConfig>>);
  readClipboard = jest.fn(async () => null);
  monitor = new ClipboardMonitor({
    registerCopyLifecycleCallbacks: jest.fn(),
    getClipboardContent: readClipboard,
  } as unknown as LocalClipboard);
});

afterEach(async () => {
  await monitor.stop();
});

it('Headless 恢复关闭时，监听断开进入轮询，重连后自动恢复事件模式', async () => {
  await monitor.start();
  expect(setTimer).not.toHaveBeenCalled();
  events.get('onPrimaryClipListenerUnavailable')!();
  await Promise.resolve();
  expect(setTimer).toHaveBeenCalledTimes(1);
  expect(native.stopPrimaryClipChangedListener).not.toHaveBeenCalled();
  events.get('onPrimaryClipListenerAvailable')!();
  expect(clearTimer).toHaveBeenCalledWith('poll');
  expect(native.startPrimaryClipChangedListener).toHaveBeenCalledTimes(1);
});

it('重复断线通知不会创建多个轮询计时器，刷新配置不会误退出轮询', async () => {
  await monitor.start();
  events.get('onPrimaryClipListenerUnavailable')!();
  events.get('onPrimaryClipListenerUnavailable')!();
  await Promise.resolve();
  await monitor.refreshListeningMode();
  expect(setTimer).toHaveBeenCalledTimes(1);
  expect(clearTimer).not.toHaveBeenCalled();
});

it('首次注册失败仍保留订阅，收到恢复通知后停止轮询', async () => {
  native.startPrimaryClipChangedListener.mockResolvedValue(false);
  await monitor.start();
  expect(setTimer).toHaveBeenCalled();
  expect(events.has('onPrimaryClipListenerAvailable')).toBe(true);
  events.get('onPrimaryClipListenerAvailable')!();
  expect(clearTimer).toHaveBeenCalledWith('poll');
});

it('Shizuku 暂时不可用时仍保留获取开关的监听请求', async () => {
  native.isShizukuAvailable.mockReturnValue(false);
  native.startPrimaryClipChangedListener.mockResolvedValue(false);
  await monitor.start();
  expect(native.startPrimaryClipChangedListener).toHaveBeenCalledTimes(1);
  expect(setTimer).toHaveBeenCalled();
});

it('关闭获取开关会取消原生监听，迟到的恢复事件不能停止轮询', async () => {
  await monitor.start();
  const restored = events.get('onPrimaryClipListenerAvailable');
  jest.mocked(configService.getConfig).mockResolvedValue({
    enableShizukuClipboard: false,
    enableShizukuRecovery: true,
  } as Awaited<ReturnType<typeof configService.getConfig>>);
  await monitor.refreshListeningMode();
  expect(native.stopPrimaryClipChangedListener).toHaveBeenCalledTimes(1);
  expect(setTimer).toHaveBeenCalled();
  jest.mocked(clearTimer).mockClear();
  restored?.();
  expect(clearTimer).not.toHaveBeenCalled();
});

it('停止监控后迟到的断线和恢复通知不会启动轮询', async () => {
  await monitor.start();
  const lost = events.get('onPrimaryClipListenerUnavailable');
  const restored = events.get('onPrimaryClipListenerAvailable');
  await monitor.stop();
  lost?.();
  restored?.();
  await Promise.resolve();
  expect(setTimer).not.toHaveBeenCalled();
});

it('注册结果不能覆盖等待期间收到的更新连接状态', async () => {
  native.startPrimaryClipChangedListener.mockImplementationOnce(async () => {
    events.get('onPrimaryClipListenerAvailable')!();
    return false;
  });
  await monitor.start();
  expect(setTimer).not.toHaveBeenCalled();
});

it('启动尚未完成时暂停监控，不得在结果返回后启动轮询', async () => {
  let resolveStart!: (ready: boolean) => void;
  native.startPrimaryClipChangedListener.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        resolveStart = resolve;
      })
  );
  const starting = monitor.start();
  for (let i = 0; i < 10 && !resolveStart; i++) await Promise.resolve();
  const stopping = monitor.pauseMonitoring();
  resolveStart(false);
  await Promise.all([starting, stopping]);
  expect(setTimer).not.toHaveBeenCalled();
  expect(native.stopPrimaryClipChangedListener).toHaveBeenCalledTimes(1);
});

it('监听恢复时补读断线期间的剪贴板变化', async () => {
  await monitor.start();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const changed = jest.fn();
  monitor.addCallback(changed);
  events.get('onPrimaryClipListenerUnavailable')!();
  const content = { type: 'text', text: 'copied during outage', hasData: true };
  readClipboard.mockResolvedValue(content);
  events.get('onPrimaryClipListenerAvailable')!();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(changed).toHaveBeenCalledWith(content);
});

it('恢复时若旧轮询仍在读取，结束后仍须补读最新内容', async () => {
  await monitor.start();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  events.get('onPrimaryClipListenerUnavailable')!();
  let finishRead!: (value: null) => void;
  readClipboard.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      })
  );
  jest.mocked(setTimer).mock.calls[0][0]();
  const changed = jest.fn();
  monitor.addCallback(changed);
  const content = { type: 'text', text: 'new content after connection', hasData: true };
  readClipboard.mockResolvedValue(content);
  events.get('onPrimaryClipListenerAvailable')!();
  finishRead(null);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(changed).toHaveBeenCalledWith(content);
});
