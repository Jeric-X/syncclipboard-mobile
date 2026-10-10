import { Platform, ToastAndroid } from 'react-native';
import { getLocales } from 'expo-localization';
import i18n from '../i18n';
import { configService } from './ConfigService';
import { createColdStartNotifier } from '../utils/coldStartNotifier';

/** 在共用 JS 入口执行，无 Activity 的 sticky/SMS 启动也能提示。 */
export const notifyColdStart = createColdStartNotifier({
  platform: Platform.OS,
  loadConfig: () => configService.getConfig(),
  showToast: (config) => {
    // Headless 不挂载 I18nProvider，直接按保存的语言或系统语言翻译。
    const language =
      config.language === 'auto' ? (getLocales()[0]?.languageCode ?? 'zh') : config.language;
    const lng = language === 'zh' ? 'zh' : 'en';
    ToastAndroid.show(i18n.t('settings.coldStartToast', { lng }), ToastAndroid.SHORT);
  },
});
