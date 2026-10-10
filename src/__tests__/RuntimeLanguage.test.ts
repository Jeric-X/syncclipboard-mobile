import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from '../i18n';
import { initializeRuntimeLanguage } from '../services/RuntimeLanguage';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn() }));
jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  (getLocales as jest.Mock).mockReturnValue([{ languageCode: 'en' }]);
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
