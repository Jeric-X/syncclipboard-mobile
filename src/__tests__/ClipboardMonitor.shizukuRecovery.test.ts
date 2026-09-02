const mockSetTimer = jest.fn(
  (_callback: () => void, _interval: number, _tag: string) => 'clipboard-monitor-timer'
);
const mockClearTimer = jest.fn((_tag: string) => undefined);
const mockSubscribe = jest.fn();
const mockIsShizukuClipboardEnabled = jest.fn(async () => true);

jest.mock('react-native', () => ({
  AppState: { currentState: 'active' },
  Platform: { OS: 'android' },
}));

jest.mock('native-timer', () => ({
  setTimer: (callback: () => void, interval: number, tag: string) =>
    mockSetTimer(callback, interval, tag),
  clearTimer: (tag: string) => mockClearTimer(tag),
}));

jest.mock('shizuku-clipboard', () => ({
  subscribeToPrimaryClipChanges: (
    callback: () => void,
    onUnavailable?: () => void,
    onAvailable?: () => void
  ) => mockSubscribe(callback, onUnavailable, onAvailable),
}));

jest.mock('@/utils/clipboardProxy', () => ({
  isShizukuClipboardEnabled: () => mockIsShizukuClipboardEnabled(),
}));

jest.mock('../services/clipboard/LocalClipboard', () => ({
  LocalClipboard: jest.fn(),
  localClipboard: {
    registerCopyLifecycleCallbacks: jest.fn(),
    getClipboardContent: jest.fn(async () => null),
  },
}));

import { ClipboardMonitor } from '../services/clipboard/ClipboardMonitor';
import type { LocalClipboard } from '../services/clipboard/LocalClipboard';

describe('ClipboardMonitor Shizuku listener recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('polls while unavailable and stops polling when the retained listener recovers', async () => {
    let onUnavailable: (() => void) | undefined;
    let onAvailable: (() => void) | undefined;
    const cleanup = jest.fn(async () => undefined);
    mockSubscribe.mockImplementation(
      async (_onChanged: () => void, unavailable?: () => void, available?: () => void) => {
        onUnavailable = unavailable;
        onAvailable = available;
        return cleanup;
      }
    );

    const clipboardManager = {
      registerCopyLifecycleCallbacks: jest.fn(),
      getClipboardContent: jest.fn(async () => null),
    };
    const monitor = new ClipboardMonitor(clipboardManager as unknown as LocalClipboard);

    await monitor.start();
    expect(mockSetTimer).not.toHaveBeenCalled();

    onUnavailable?.();
    await Promise.resolve();

    expect(cleanup).not.toHaveBeenCalled();
    expect(mockSetTimer).toHaveBeenCalledTimes(1);

    onAvailable?.();

    expect(mockClearTimer).toHaveBeenCalledWith('clipboard-monitor-timer');
    await monitor.stop();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
