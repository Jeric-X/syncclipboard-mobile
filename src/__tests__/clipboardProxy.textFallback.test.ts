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

it('Shizuku 类型检查返回 false 时仍可通过悬浮窗读取文本', async () => {
  (overlay.hasStringViaOverlay as jest.Mock).mockResolvedValue(true);
  (overlay.getStringViaOverlay as jest.Mock).mockResolvedValue('overlay text');

  expect(await hasStringAsync()).toBe(true);
  expect(await getStringAsync()).toBe('overlay text');
  expect(releaseOverlay).toHaveBeenCalledTimes(2);
  expect(Clipboard.hasStringAsync).not.toHaveBeenCalled();
});

it('Shizuku 和悬浮窗均读不到时仍尝试系统文本接口', async () => {
  (Clipboard.hasStringAsync as jest.Mock).mockResolvedValue(true);
  (Clipboard.getStringAsync as jest.Mock).mockResolvedValue('system text');

  expect(await hasStringAsync()).toBe(true);
  expect(await getStringAsync()).toBe('system text');
  expect(releaseOverlay).toHaveBeenCalledTimes(2);
});

it('只有图片、各接口均无文字时不将 URI 当作文本', async () => {
  expect(await hasStringAsync()).toBe(false);
  expect(overlay.hasStringViaOverlay).toHaveBeenCalled();
  expect(Clipboard.hasStringAsync).toHaveBeenCalled();
  expect(overlay.getStringViaOverlay).not.toHaveBeenCalled();
});

it('Shizuku 能识别文本时无需唤起悬浮窗', async () => {
  (shizuku.hasStringViaShizuku as jest.Mock).mockResolvedValue(true);

  expect(await hasStringAsync()).toBe(true);
  expect(acquireClipboardOverlay).not.toHaveBeenCalled();
});
