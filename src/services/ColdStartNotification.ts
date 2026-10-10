import { Platform, ToastAndroid } from 'react-native';
import { getLocales } from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../i18n';
import { configService } from './ConfigService';
import { createColdStartNotifier } from '../utils/coldStartNotifier';
import { LANGUAGE_STORAGE_KEY, resolveLanguagePreference } from '../utils/languagePreference';

/** 在共用 JS 入口执行，无 Activity 的 sticky/SMS 启动也能提示。 */
export const notifyColdStart = createColdStartNotifier({
  platform: Platform.OS,
  loadConfig: async () => {
    const config = await configService.getConfig();
    if (!config.debugMode || !config.debugColdStartToast) return config;
    // Headless 不挂载 I18nProvider，读取与语言选择器相同的持久化偏好。
    const saved = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    return {
      ...config,
      language: resolveLanguagePreference(saved, getLocales()[0]?.languageCode ?? null),
    };
  },
  showToast: (config) => {
    ToastAndroid.show(
      i18n.t('settings.coldStartToast', { lng: config.language }),
      ToastAndroid.SHORT
    );
  },
});
