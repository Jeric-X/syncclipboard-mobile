import React from 'react';
// @ts-expect-error React Native 的 Jest 依赖提供 renderer，但未附带类型声明。
import TestRenderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import type { SettingsDetailSection } from '../navigation/types';

jest.mock('../components', () => ({ MessageToast: 'MessageToast' }));
jest.mock('../components/settings', () => ({ SettingItem: 'SettingItem' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('react-native-feather', () => ({ ChevronRight: 'ChevronRight' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../hooks/useTheme', () => ({ useTheme: () => ({ theme: { colors: {} } }) }));
jest.mock('../stores', () => ({
  useSettingsStore: () => ({ isLoaded: true, loadConfig: jest.fn() }),
}));
jest.mock('../screens/settings/ServerSettings', () => ({ ServerSettings: 'ServerSettings' }));
jest.mock('../screens/settings/SyncAndHistorySettings', () => ({
  SyncAndHistorySettings: 'SyncAndHistorySettings',
}));
jest.mock('../screens/settings/BackgroundSettings', () => ({
  BackgroundSettings: 'BackgroundSettings',
}));
jest.mock('../screens/settings/PermissionsSettings', () => ({
  PermissionsSettings: 'PermissionsSettings',
}));
jest.mock('../screens/settings/StorageSettings', () => ({ StorageSettings: 'StorageSettings' }));
jest.mock('../screens/settings/LogsAndDebugSettings', () => ({
  LogsAndDebugSettings: 'LogsAndDebugSettings',
}));
jest.mock('../screens/settings/ShortcutSettings', () => ({ ShortcutSettings: 'ShortcutSettings' }));
jest.mock('../screens/settings/AppearanceSettings', () => ({
  AppearanceSettings: 'AppearanceSettings',
}));
jest.mock('../screens/settings/AboutSettings', () => ({ AboutSettings: 'AboutSettings' }));

const details: [SettingsDetailSection, string][] = [
  ['syncAndHistorySection', 'SyncAndHistorySettings'],
  ['backgroundTasksSection', 'BackgroundSettings'],
  ['permissionsSection', 'PermissionsSettings'],
  ['storageSection', 'StorageSettings'],
  ['logsAndDebugSection', 'LogsAndDebugSettings'],
];
const mainModules = ['ServerSettings', 'ShortcutSettings', 'AppearanceSettings', 'AboutSettings'];
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousActEnvironment: boolean | undefined;
let previousPlatform: typeof Platform.OS;
let root: ReturnType<typeof TestRenderer.create>;
const navigate = jest.fn();

function screen(section?: SettingsDetailSection) {
  const props = {
    navigation: { navigate },
    route: section
      ? { key: section, name: 'SettingsDetail', params: { section } }
      : { key: 'main', name: 'SettingsMain' },
  } as unknown as React.ComponentProps<typeof SettingsScreen>;
  return <SettingsScreen {...props} />;
}

beforeEach(() => {
  jest.clearAllMocks();
  previousPlatform = Platform.OS;
  Platform.OS = 'android';
  previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT;
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  Platform.OS = previousPlatform;
  testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

it('一级页面只挂载常用模块，入口位于服务器之后并跳转到对应二级页', async () => {
  await act(async () => {
    root = TestRenderer.create(screen());
  });
  for (const name of mainModules) expect(root.root.findAllByType(name)).toHaveLength(1);
  for (const [, name] of details) expect(root.root.findAllByType(name)).toHaveLength(0);
  const entries = root.root.findAllByType('SettingItem');
  expect(entries).toHaveLength(details.length);
  for (const [index, [section]] of details.entries()) {
    expect(entries[index].props.label).toBe(`settings.${section}`);
    await act(async () => entries[index].props.onPress());
    expect(navigate).toHaveBeenLastCalledWith('SettingsDetail', { section });
  }
  const content = root.toJSON().children[0].children[0].children;
  expect(content[0].type).toBe('ServerSettings');
  expect(content[1].children[0].props.label).toBe('settings.syncAndHistorySection');
});

it.each(details)('%s 只挂载所属模块，消息由页面统一展示', async (section, expected) => {
  await act(async () => {
    root = TestRenderer.create(screen(section));
  });
  expect(root.root.findAllByType(expected)).toHaveLength(1);
  for (const name of mainModules) expect(root.root.findAllByType(name)).toHaveLength(0);
  for (const [, name] of details) {
    if (name !== expected) expect(root.root.findAllByType(name)).toHaveLength(0);
  }
  if (section !== 'permissionsSection') {
    await act(async () => root.root.findByType(expected).props.showMessage('已保存', 'success'));
    expect(root.root.findByType('MessageToast').props.message).toEqual({
      text: '已保存',
      type: 'success',
    });
  }
  await act(async () => {
    root.update(screen());
  });
  expect(root.root.findAllByType(expected)).toHaveLength(0);
  expect(root.root.findAllByType('ServerSettings')).toHaveLength(1);
});

it('iOS 不显示后台任务和 Android 权限入口', async () => {
  Platform.OS = 'ios';
  await act(async () => {
    root = TestRenderer.create(screen());
  });
  const labels = root.root
    .findAllByType('SettingItem')
    .map((item: { props: { label: string } }) => item.props.label);
  expect(labels).toEqual([
    'settings.syncAndHistorySection',
    'settings.storageSection',
    'settings.logsAndDebugSection',
  ]);
});
