import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from '../i18n';
import {
  initializeRuntimeLanguage,
  getRuntimeLanguageState,
  setRuntimeLanguage,
  subscribeRuntimeLanguage,
  refreshRuntimeSystemLanguage,
} from '../services/RuntimeLanguage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  (getLocales as jest.Mock).mockReturnValue([{ languageCode: 'en' }]);
  (AsyncStorage.setItem as jest.Mock).mockReset().mockResolvedValue(undefined);
});

it('主动切换持久化并通知共享状态，失败不发布，之后仍可切换', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue('zh');
  await initializeRuntimeLanguage();
  const listener = jest.fn();
  const unsubscribe = subscribeRuntimeLanguage(listener);
  try {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await expect(setRuntimeLanguage('en')).rejects.toThrow('disk full');
    expect(getRuntimeLanguageState().language).toBe('zh');
    expect(listener).not.toHaveBeenCalled();
    await setRuntimeLanguage('en');
    expect(getRuntimeLanguageState().language).toBe('en');
    expect(i18n.language).toBe('en');
    expect(listener).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
  }
});

it('系统语言刷新不重新读取存储，auto 跟随系统', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue('auto');
  await initializeRuntimeLanguage();
  (getLocales as jest.Mock).mockReturnValue([{ languageCode: 'zh' }]);
  await refreshRuntimeSystemLanguage();
  expect(getRuntimeLanguageState()).toEqual({
    language: 'auto',
    resolvedLanguage: 'zh',
    systemLanguage: 'zh',
  });
  expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
});

it('无 UI 时按保存的中文偏好初始化上传/下载翻译', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue('zh');
  await initializeRuntimeLanguage();
  expect(i18n.t('common.uploaded', { preview: 'abc' })).toBe('已上传\nabc');
  expect(i18n.t('common.downloaded', { preview: 'abc' })).toBe('已下载\nabc');
});

it('auto 跟随中文系统，显式英文偏好优先于系统', async () => {
  (getLocales as jest.Mock).mockReturnValue([{ languageCode: 'zh' }]);
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue('auto');
  await initializeRuntimeLanguage();
  expect(i18n.language).toBe('zh');
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue('en');
  await initializeRuntimeLanguage();
  expect(i18n.language).toBe('en');
});

it('存储失败时回退系统语言，仍允许启动后台任务', async () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  (getLocales as jest.Mock).mockReturnValue([{ languageCode: 'zh' }]);
  (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('storage unavailable'));
  try {
    await expect(initializeRuntimeLanguage()).resolves.toBeUndefined();
    expect(i18n.language).toBe('zh');
  } finally {
    error.mockRestore();
  }
});
