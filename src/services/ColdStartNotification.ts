import { Platform, ToastAndroid } from 'react-native';
import i18n from '../i18n';
import { configService } from './ConfigService';
import type { AppConfig } from '../types/storage';
import { initializeAppFoundation } from './AppFoundation';
import { getRuntimeLanguageState } from './RuntimeLanguage';

type ColdStartConfig = Pick<AppConfig, 'debugMode' | 'debugColdStartToast' | 'language'>;

interface ColdStartNotifierDeps {
  platform: string;
  loadConfig: () => Promise<ColdStartConfig>;
  showToast: (config: ColdStartConfig) => void;
}

/** 每个运行时只检查一次冷启动开关；重复调用共享结果，开启开关不补发旧启动提示。 */
export function createColdStartNotifier(deps: ColdStartNotifierDeps): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => {
    if (!pending) {
      pending = (async () => {
        if (deps.platform !== 'android') return;
        const config = await deps.loadConfig();
        if (config.debugMode && config.debugColdStartToast) deps.showToast(config);
      })();
    }
    return pending;
  };
}

/** 在共用 JS 入口执行，无 Activity 的 sticky/SMS 启动也能提示。 */
export const notifyColdStart = createColdStartNotifier({
  platform: Platform.OS,
  loadConfig: async () => {
    const config = await configService.getConfig();
    if (!config.debugMode || !config.debugColdStartToast) return config;
    await initializeAppFoundation();
    return {
      ...config,
      language: getRuntimeLanguageState().resolvedLanguage,
    };
  },
  showToast: (config) => {
    ToastAndroid.show(
      i18n.t('settings.coldStartToast', { lng: config.language }),
      ToastAndroid.SHORT
    );
  },
});
