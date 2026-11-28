import React from 'react';
// @ts-expect-error React Native 的 Jest 依赖提供 renderer，但未附带类型声明。
import TestRenderer, { act } from 'react-test-renderer';
import { create } from 'zustand';
import { AppState, Linking, Platform } from 'react-native';
import { clearSharedPayloads, getSharedPayloads } from 'expo-sharing';
import App from '../../App';
import { DirectShareReceiveScreen } from '../screens/DirectShareReceiveScreen';
import { takeSharedImage } from '../services/clipboard/incomingSharedImage';
jest.mock('../services/clipboard/incomingSharedImage', () => ({ takeSharedImage: jest.fn() }));
import { ShareReceiveScreen } from '../screens/ShareReceiveScreen';
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
    .mockReturnValueOnce([
      { shareType: 'text', value: text, mimeType: 'text/plain' },
      { shareType: 'url', value: article, mimeType: 'text/html' },
    ])
    .mockReturnValue([]);
  const subscribe = jest.spyOn(Linking, 'addEventListener');

  await act(async () => {
    root = TestRenderer.create(<App />);
  });
  expect(root.root.findByType(ProcessTextScreen).props.text).toBe(article);

  const onUrl = subscribe.mock.calls.filter(([type]) => type === 'url').at(-1)![1];
  await act(async () => onUrl({ url }));
  expect(root.root.findByType(ProcessTextScreen).props.text).toBe(text);
  await act(async () => onUrl({ url }));
  expect(clearSharedPayloads).toHaveBeenCalledTimes(2);
  expect(root.root.findByType(ProcessTextScreen).props.text).toBe(text);
  await act(async () => root.root.findByType(ProcessTextScreen).props.onComplete());
  expect(root.root.findAllByType(ProcessTextScreen)).toHaveLength(0);
  expect(root.root.findAllByType(AppNavigator)).toHaveLength(1);
});

it('iOS 将单张图片交给上传页，重复唤起不重复上传，关闭时释放缓存', async () => {
  Platform.OS = 'ios';
  const url = 'syncclipboard://expo-sharing';
  const uri = 'file:///group/photo.png';
  const image = {
    data: {
      type: 'file' as const,
      fileName: 'photo.png',
      uri: 'file:///cache/snapshot.png',
      mimeType: 'image/png',
    },
    dispose: jest.fn(),
  };
  jest.mocked(takeSharedImage).mockReturnValue(image);
  jest.mocked(Linking.getInitialURL).mockResolvedValue(url);
  jest
    .mocked(getSharedPayloads)
    .mockReturnValueOnce([
      { shareType: 'text', value: 'caption', mimeType: 'text/plain' },
      { shareType: 'image', value: uri, mimeType: 'image/png' },
    ])
    .mockReturnValue([]);
  const subscribe = jest.spyOn(Linking, 'addEventListener');
  await act(async () => {
    root = TestRenderer.create(<App />);
  });
  expect(takeSharedImage).toHaveBeenCalledWith(uri, 'image/png');
  expect(root.root.findByType(DirectShareReceiveScreen).props.shareData).toEqual(image.data);
  const onUrl = subscribe.mock.calls.filter(([type]) => type === 'url').at(-1)![1];
  await act(async () => onUrl({ url }));
  expect(takeSharedImage).toHaveBeenCalledTimes(1);
  expect(image.dispose).not.toHaveBeenCalled();
  await act(async () => root.root.findByType(DirectShareReceiveScreen).props.onComplete());
  expect(image.dispose).toHaveBeenCalledTimes(1);
});

it('iOS 在普通启动加载配置期间收到分享，配置就绪后消费一次', async () => {
  Platform.OS = 'ios';
  mockLoadConfig.mockImplementationOnce(async () => {});
  jest
    .mocked(getSharedPayloads)
    .mockReturnValueOnce([
      { shareType: 'url', value: 'https://example.org', mimeType: 'text/html' },
    ])
    .mockReturnValue([]);
  await act(async () => {
    root = TestRenderer.create(<App />);
  });
  expect(getSharedPayloads).not.toHaveBeenCalled();
  await act(async () => mockSettingsStore.setState({ isLoaded: true }));
  expect(root.root.findByType(ProcessTextScreen).props.text).toBe('https://example.org');
  expect(clearSharedPayloads).toHaveBeenCalledTimes(1);
});

it('iOS 热恢复即使没有 URL 事件也会处理待收图片', async () => {
  Platform.OS = 'ios';
  const subscribe = jest.spyOn(AppState, 'addEventListener');
  jest.mocked(getSharedPayloads).mockReturnValue([]);
  await act(async () => {
    root = TestRenderer.create(<App />);
  });
  const image = {
    data: {
      type: 'file' as const,
      uri: 'file:///cache/item',
      fileName: 'photo.png',
      mimeType: 'image/png',
    },
    dispose: jest.fn(),
  };
  jest.mocked(takeSharedImage).mockReturnValue(image);
  jest
    .mocked(getSharedPayloads)
    .mockReturnValueOnce([
      { shareType: 'image', value: 'file:///group/photo.png', mimeType: 'image/png' },
    ]);
  const resume = subscribe.mock.calls.find(([type]) => type === 'change')![1];
  await act(async () => resume('active'));
  await act(async () => resume('active'));
  expect(root.root.findByType(DirectShareReceiveScreen).props.shareData).toBe(image.data);
  expect(clearSharedPayloads).toHaveBeenCalledTimes(1);
});

it('Android 重复的初始与热分享链接复用同一个上传页', async () => {
  const url = 'syncclipboard://expo-sharing';
  jest.mocked(Linking.getInitialURL).mockResolvedValue(url);
  const subscribe = jest.spyOn(Linking, 'addEventListener');
  await act(async () => {
    root = TestRenderer.create(<App />);
  });
  const screen = root.root.findByType(ShareReceiveScreen);
  const onUrl = subscribe.mock.calls.filter(([type]) => type === 'url').at(-1)![1];
  await act(async () => onUrl({ url }));
  expect(root.root.findByType(ShareReceiveScreen)).toBe(screen);
  expect(networkAutoSwitchService.ensureCurrentServer).toHaveBeenCalledTimes(1);
});
