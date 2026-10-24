import AsyncStorage from '@react-native-async-storage/async-storage';
import { ToastAndroid } from 'react-native';
import { notifyColdStart } from '../services/ColdStartNotification';

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  ToastAndroid: { SHORT: 0, show: jest.fn() },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn() }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
jest.mock('../services/ConfigService', () => ({
  configService: {
    getConfig: async () => ({ debugMode: true, debugColdStartToast: true, language: 'zh-CN' }),
  },
}));

it('Headless Toast 使用独立存储中的中文偏好，不使用旧 AppConfig.language', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue('zh');
  await notifyColdStart();
  expect(AsyncStorage.getItem).toHaveBeenCalledWith('@syncclipboard:language');
  expect(ToastAndroid.show).toHaveBeenCalledWith('SyncClipboard 已冷启动', ToastAndroid.SHORT);
});
