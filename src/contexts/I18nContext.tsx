/**
 * UI 订阅公共语言状态；基础初始化就绪前不挂载页面，避免默认语言首屏。
 */
import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useSyncExternalStore,
} from 'react';
import { useLocales } from 'expo-localization';
import type { Language, SupportedLanguage } from '@/i18n';
import {
  initializeAppFoundation,
  isAppFoundationReady,
  setAppLanguage,
} from '@/services/AppFoundation';
import {
  getRuntimeLanguageState,
  subscribeRuntimeLanguage,
  refreshRuntimeSystemLanguage,
} from '@/services/RuntimeLanguage';

interface I18nContextValue {
  language: Language;
  resolvedLanguage: SupportedLanguage;
  systemLanguage: SupportedLanguage;
  setLanguage: (lang: Language) => Promise<void>;
}

export const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(isAppFoundationReady);
  const languageState = useSyncExternalStore(subscribeRuntimeLanguage, getRuntimeLanguageState);
  const systemLanguageCode = useLocales()[0]?.languageCode;

  useEffect(() => {
    let active = true;
    initializeAppFoundation().then(
      () => {
        if (active) setReady(true);
      },
      (error) => console.error('[I18nProvider] Foundation initialization failed:', error)
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (ready) {
      refreshRuntimeSystemLanguage().catch((error) =>
        console.error('Failed to refresh language:', error)
      );
    }
  }, [ready, systemLanguageCode]);

  const setLanguage = useCallback(async (language: Language) => {
    try {
      await setAppLanguage(language);
    } catch (error) {
      console.error('Failed to save language:', error);
    }
  }, []);

  if (!ready) return null;
  return (
    <I18nContext.Provider value={{ ...languageState, setLanguage }}>
      {children}
    </I18nContext.Provider>
  );
};
