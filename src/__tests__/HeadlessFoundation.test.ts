import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from '../i18n';
import { prepareAppFoundation, setAppLanguage } from '../services/AppFoundation';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('auto'),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));

it('无 UI 的重复服务入口刷新 auto，不重复读存储、不覆盖显式偏好', async () => {
  (getLocales as jest.Mock).mockReturnValue([{ languageCode: 'en' }]);
  await prepareAppFoundation();
  expect(i18n.language).toBe('en');
  (getLocales as jest.Mock).mockReturnValue([{ languageCode: 'zh' }]);
  await prepareAppFoundation();
  expect(i18n.t('common.uploaded', { preview: 'abc' })).toBe('已上传\nabc');
  expect(i18n.t('common.downloaded', { preview: 'abc' })).toBe('已下载\nabc');
  await setAppLanguage('en');
  await prepareAppFoundation();
  expect(i18n.language).toBe('en');
  expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
});
