import React from 'react';
// @ts-expect-error React Native 的 Jest 依赖提供 renderer，但未附带类型声明。
import TestRenderer, { act } from 'react-test-renderer';
import { create } from 'zustand';
import { Linking, Platform } from 'react-native';
import { clearSharedPayloads, getSharedPayloads } from 'expo-sharing';
import App from '../../App';
import { ProcessTextScreen } from '../screens/ProcessTextScreen';
import QuickActionApp from '../QuickActionApp';
import { AppNavigator } from '../navigation/AppNavigator';
import { QuickTileLoadingScreen } from '../screens/QuickTileLoadingScreen';
import { requestServiceRuntime, startServiceRuntime } from '../services/ServiceRuntime';
import { networkAutoSwitchService } from '../services/NetworkAutoSwitchService';

jest.mock('expo-sharing', () => ({ clearSharedPayloads: jest.fn(), getSharedPayloads: jest.fn() }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: 'Root' }));
jest.mock('../contexts/ThemeContext', () => ({ ThemeProvider: 'ThemeProvider' }));
jest.mock('../contexts/I18nContext', () => ({ I18nProvider: 'I18nProvider' }));
jest.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: { isDark: false, colors: { surface: 'white' } } }),
}));
jest.mock('../i18n', () => ({}));
jest.mock('../navigation/AppNavigator', () => ({ AppNavigator: 'AppNavigator' }));
jest.mock('../screens/QuickTileLoadingScreen', () => ({ QuickTileLoadingScreen: 'QuickTile' }));
jest.mock('../screens/ShareReceiveScreen', () => ({ ShareReceiveScreen: 'ShareReceive' }));
jest.mock('../screens/ProcessTextScreen', () => ({ ProcessTextScreen: 'ProcessText' }));
jest.mock('../screens/DirectShareReceiveScreen', () => ({
  DirectShareReceiveScreen: 'DirectShare',
}));
jest.mock('../utils/Logger', () => ({ initLogger: jest.fn() }));
jest.mock('shortcut', () => ({ setDynamicShortcuts: jest.fn() }));
jest.mock('../services/ServiceRuntime', () => ({
  requestServiceRuntime: jest.fn(),
  startServiceRuntime: jest.fn(),
}));
jest.mock('../services/NetworkAutoSwitchService', () => ({
  networkAutoSwitchService: { ensureCurrentServer: jest.fn() },
}));
jest.mock('../stores', () => ({ useSettingsStore: () => mockSettingsStore() }));

const mockLoadConfig = jest.fn(async () => {
  mockSettingsStore.setState({ isLoaded: true });
});
const mockSettingsStore = create(() => ({
  config: { hideFromRecents: false, debugUrlScheme: false },
  isLoaded: false,
  loadConfig: mockLoadConfig,
}));

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let originalActEnvironment: boolean | undefined;
let root: ReturnType<typeof TestRenderer.create>;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  originalActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT;
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  mockSettingsStore.setState({ isLoaded: false });
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('syncclipboard://home');
  (networkAutoSwitchService.ensureCurrentServer as jest.Mock).mockResolvedValue(undefined);
  (requestServiceRuntime as jest.Mock).mockRejectedValue(new Error('Headless unavailable'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root?.unmount());
  jest.restoreAllMocks();
  testGlobal.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
});

it('Android 主界面独立加载配置并显示导航，不调用任务初始化', async () => {
  await act(async () => {
    root = TestRenderer.create(<App />);
  });
  expect(mockLoadConfig).toHaveBeenCalledTimes(1);
  expect(root.root.findAllByType(AppNavigator)).toHaveLength(1);
  expect(startServiceRuntime).not.toHaveBeenCalled();
});

it('Headless 请求失败时快捷页仍可加载配置并显示', async () => {
  await act(async () => {
    root = TestRenderer.create(<QuickActionApp />);
  });
  expect(mockLoadConfig).toHaveBeenCalledTimes(1);
  expect(requestServiceRuntime).toHaveBeenCalledTimes(1);
  expect(root.root.findAllByType(QuickTileLoadingScreen)).toHaveLength(1);
  expect(startServiceRuntime).not.toHaveBeenCalled();
});

it('Headless 一直未就绪也不阻塞快捷页显示', async () => {
  mockSettingsStore.setState({ isLoaded: true });
  (requestServiceRuntime as jest.Mock).mockReturnValue(new Promise<void>(() => {}));
  await act(async () => {
    root = TestRenderer.create(<QuickActionApp />);
  });
  expect(requestServiceRuntime).toHaveBeenCalledTimes(1);
  expect(root.root.findAllByType(QuickTileLoadingScreen)).toHaveLength(1);
  expect(mockLoadConfig).not.toHaveBeenCalled();
});

it('快捷页仍等待服务器选择完成后显示', async () => {
  mockSettingsStore.setState({ isLoaded: true });
  let finish!: () => void;
  (networkAutoSwitchService.ensureCurrentServer as jest.Mock).mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  await act(async () => {
    root = TestRenderer.create(<QuickActionApp />);
  });
  expect(root.toJSON()).toBeNull();
  await act(async () => {
    finish();
  });
  expect(root.root.findAllByType(QuickTileLoadingScreen)).toHaveLength(1);
});

it('iOS 冷启动接收网址，热启动时替换为新分享的原文，并忽略重复的空唤起', async () => {
  Platform.OS = 'ios';
  const url = 'syncclipboard://expo-sharing';
  const article = 'https://example.com/private?x=1#section';
  const text = '  第二条\n分享 📋  ';
  jest.mocked(Linking.getInitialURL).mockResolvedValue(url);
  jest
    .mocked(getSharedPayloads)
    .mockReturnValueOnce([{ shareType: 'url', value: article, mimeType: 'text/html' }])
    .mockReturnValueOnce([{ shareType: 'text', value: text, mimeType: 'text/plain' }])
    .mockReturnValue([]);
  const subscribe = jest.spyOn(Linking, 'addEventListener');

  await act(async () => {
    root = TestRenderer.create(<App />);
  });
  expect(root.root.findByType(ProcessTextScreen).props.text).toBe(article);

  const onUrl = subscribe.mock.calls.find(([type]) => type === 'url')![1];
  await act(async () => onUrl({ url }));
  expect(root.root.findByType(ProcessTextScreen).props.text).toBe(text);
  await act(async () => onUrl({ url }));
  expect(clearSharedPayloads).toHaveBeenCalledTimes(2);
  expect(root.root.findByType(ProcessTextScreen).props.text).toBe(text);
  await act(async () => root.root.findByType(ProcessTextScreen).props.onComplete());
  expect(root.root.findAllByType(ProcessTextScreen)).toHaveLength(0);
  expect(root.root.findAllByType(AppNavigator)).toHaveLength(1);
});
