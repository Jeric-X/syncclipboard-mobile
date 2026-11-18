import * as Clipboard from 'expo-clipboard';
import * as overlay from 'clipboard-overlay';
import * as shizuku from 'shizuku-clipboard';
import { acquireClipboardOverlay } from '@/services/overlay/OverlayManager';
import { getStringAsync, hasStringAsync } from '@/utils/clipboardProxy';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('@/services/ConfigService', () => ({
  configService: { getConfig: () => Promise.resolve({ enableShizukuClipboard: true }) },
}));
jest.mock('expo-clipboard', () => ({ hasStringAsync: jest.fn(), getStringAsync: jest.fn() }));
jest.mock('shizuku-clipboard', () => ({
  isShizukuAvailable: () => true,
  hasShizukuPermission: () => true,
  hasStringViaShizuku: jest.fn(),
  getStringViaShizuku: jest.fn(),
}));
jest.mock('clipboard-overlay', () => ({
  hasStringViaOverlay: jest.fn(),
  getStringViaOverlay: jest.fn(),
}));
jest.mock('@/services/overlay/OverlayManager', () => ({ acquireClipboardOverlay: jest.fn() }));

const releaseOverlay = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (shizuku.hasStringViaShizuku as jest.Mock).mockResolvedValue(false);
  (shizuku.getStringViaShizuku as jest.Mock).mockResolvedValue('');
  (acquireClipboardOverlay as jest.Mock).mockResolvedValue(releaseOverlay);
  (overlay.hasStringViaOverlay as jest.Mock).mockResolvedValue(false);
  (overlay.getStringViaOverlay as jest.Mock).mockResolvedValue('');
  (Clipboard.hasStringAsync as jest.Mock).mockResolvedValue(false);
  (Clipboard.getStringAsync as jest.Mock).mockResolvedValue('');
});

it('Shizuku 确认没有文字时直接返回，不唤起悬浮窗或系统回退', async () => {
  expect(await hasStringAsync()).toBe(false);
  expect(acquireClipboardOverlay).not.toHaveBeenCalled();
  expect(Clipboard.hasStringAsync).not.toHaveBeenCalled();
});

it('Shizuku 文本类型检查抛出读取错误时才通过悬浮窗回退', async () => {
  (shizuku.hasStringViaShizuku as jest.Mock).mockRejectedValue(new Error('service unavailable'));
  (overlay.hasStringViaOverlay as jest.Mock).mockResolvedValue(true);
  (overlay.getStringViaOverlay as jest.Mock).mockResolvedValue('overlay text');

  expect(await hasStringAsync()).toBe(true);
  expect(await getStringAsync()).toBe('overlay text');
  expect(releaseOverlay).toHaveBeenCalledTimes(2);
  expect(Clipboard.hasStringAsync).not.toHaveBeenCalled();
});

it('Shizuku 和悬浮窗均抛出错误时才尝试系统文本接口', async () => {
  (shizuku.hasStringViaShizuku as jest.Mock).mockRejectedValue(new Error('service unavailable'));
  (overlay.hasStringViaOverlay as jest.Mock).mockRejectedValue(new Error('overlay failed'));
  (Clipboard.hasStringAsync as jest.Mock).mockResolvedValue(true);
  (Clipboard.getStringAsync as jest.Mock).mockResolvedValue('system text');

  expect(await hasStringAsync()).toBe(true);
  expect(await getStringAsync()).toBe('system text');
  expect(releaseOverlay).toHaveBeenCalledTimes(2);
});

it('悬浮窗确认没有文字时直接返回并释放窗口，不调用系统回退', async () => {
  (shizuku.hasStringViaShizuku as jest.Mock).mockRejectedValue(new Error('service unavailable'));
  expect(await hasStringAsync()).toBe(false);
  expect(overlay.hasStringViaOverlay).toHaveBeenCalled();
  expect(releaseOverlay).toHaveBeenCalledTimes(1);
  expect(Clipboard.hasStringAsync).not.toHaveBeenCalled();
  expect(overlay.getStringViaOverlay).not.toHaveBeenCalled();
});

it('Shizuku 能识别文本时无需唤起悬浮窗', async () => {
  (shizuku.hasStringViaShizuku as jest.Mock).mockResolvedValue(true);

  expect(await hasStringAsync()).toBe(true);
  expect(acquireClipboardOverlay).not.toHaveBeenCalled();
});
