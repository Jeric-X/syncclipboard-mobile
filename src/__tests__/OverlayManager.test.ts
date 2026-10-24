jest.mock('react-native', () => ({
  AppState: { currentState: 'background', addEventListener: jest.fn() },
  Platform: { OS: 'android' },
}));
jest.mock('clipboard-overlay', () => ({
  hasOverlayPermission: jest.fn(() => true),
  isOverlayShowing: jest.fn(() => false),
  showOverlayWindow: jest.fn(async () => true),
  hideOverlayWindow: jest.fn(async () => true),
  setDebugMode: jest.fn(),
  setMaxRetries: jest.fn(),
}));
jest.mock('native-timer', () => ({ setTimer: jest.fn(), clearTimer: jest.fn() }));
jest.mock('../services/ConfigService', () => ({
  configService: { getConfig: jest.fn(), subscribe: jest.fn() },
}));

import { AppState, Platform } from 'react-native';
import * as overlayModule from 'clipboard-overlay';
import { configService } from '../services/ConfigService';
import {
  acquireKeepAliveOverlay,
  acquireClipboardOverlay,
  dismissClipboardOverlay,
} from '../services/overlay/OverlayManager';
import { DEFAULT_APP_CONFIG } from '../types/storage';

/** 等待配置订阅提交的窗口更新，不触发任何剪贴板读取。 */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('headless startup loads settings, live toggles update the window, and stop releases it', async () => {
  let showing = false;
  jest.mocked(overlayModule.isOverlayShowing).mockImplementation(() => showing);
  jest.mocked(overlayModule.showOverlayWindow).mockImplementation(async () => {
    showing = true;
    return true;
  });
  jest.mocked(overlayModule.hideOverlayWindow).mockImplementation(async () => {
    showing = false;
    return true;
  });
  const config = {
    ...DEFAULT_APP_CONFIG,
    enableBackgroundTasks: true,
    enableOverlayKeepAlive: true,
  };
  let load!: (value: typeof config) => void;
  jest.mocked(configService.getConfig).mockReturnValueOnce(
    new Promise((resolve) => {
      load = resolve;
    })
  );
  const update = jest.mocked(configService.subscribe).mock.calls[0][0];
  const stop = acquireKeepAliveOverlay();
  // 配置仍在加载时用户修改了设置；旧读取结果不能覆盖新配置。
  update({ ...config, enableOverlayKeepAlive: false });
  load(config);
  await settle();
  expect(showing).toBe(false);
  update(config);
  await settle();
  expect(showing).toBe(true);
  expect(await acquireClipboardOverlay()).toBeNull();
  update({ ...config, enableBackgroundTasks: false });
  await settle();
  expect(showing).toBe(false);
  update(config);
  await settle();
  expect(showing).toBe(true);
  update({ ...config, debugMode: true, debugOverlayVisible: true });
  await settle();
  expect(overlayModule.setDebugMode).toHaveBeenLastCalledWith(true);
  const change = jest.mocked(AppState.addEventListener).mock.calls[0][1];
  change('active');
  await dismissClipboardOverlay();
  expect(showing).toBe(true);
  await stop();
  expect(showing).toBe(false);
});

test('unsupported platforms do not request a native window', async () => {
  const previous = Platform.OS;
  Platform.OS = 'ios';
  try {
    jest.mocked(overlayModule.showOverlayWindow).mockClear();
    const stop = acquireKeepAliveOverlay();
    expect(await acquireClipboardOverlay()).toBeNull();
    await dismissClipboardOverlay();
    await stop();
    expect(overlayModule.showOverlayWindow).not.toHaveBeenCalled();
  } finally {
    Platform.OS = previous;
  }
});
