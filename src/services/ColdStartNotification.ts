import { Platform, ToastAndroid } from 'react-native';
import i18n from '../i18n';
import { configService } from './ConfigService';
import { createColdStartNotifier } from '../utils/coldStartNotifier';
import { loadRuntimeLanguage } from './RuntimeLanguage';

/** 在共用 JS 入口执行，无 Activity 的 sticky/SMS 启动也能提示。 */
export const notifyColdStart = createColdStartNotifier({
  platform: Platform.OS,
  loadConfig: async () => {
    const config = await configService.getConfig();
    if (!config.debugMode || !config.debugColdStartToast) return config;
    // Headless 不挂载 I18nProvider，读取与语言选择器相同的持久化偏好。
    return {
      ...config,
      language: await loadRuntimeLanguage(),
    };
  },
  showToast: (config) => {
    ToastAndroid.show(
      i18n.t('settings.coldStartToast', { lng: config.language }),
      ToastAndroid.SHORT
    );
  },
});
