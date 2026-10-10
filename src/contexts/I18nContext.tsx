/**
 * I18n 上下文
 * 提供语言切换和访问功能，参考 ThemeContext 模式
 */

import React, { createContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import i18n, { type Language, type SupportedLanguage, SUPPORTED_LANGUAGES } from '@/i18n';

import { LANGUAGE_STORAGE_KEY } from '@/utils/languagePreference';

interface I18nContextValue {
  /** 用户设置的语言偏好（含 'auto'） */
  language: Language;
  /** 实际生效的语言（不含 'auto'） */
  resolvedLanguage: SupportedLanguage;
  /** 系统检测到的语言（'auto' 选项跟随的目标） */
  systemLanguage: SupportedLanguage;
  /** 切换语言并持久化 */
  setLanguage: (lang: Language) => Promise<void>;
}

export const I18nContext = createContext<I18nContextValue | undefined>(undefined);

interface I18nProviderProps {
  children: React.ReactNode;
}

/** 从 Expo Localization 获取系统语言，映射到支持的语言 */
function getSystemLanguage(): SupportedLanguage {
  const locales = Localization.getLocales();
  const systemLang = locales[0]?.languageCode ?? 'zh';
  return systemLang === 'zh' ? 'zh' : 'en';
}

/** 将语言偏好解析为实际语言 */
function resolveLanguage(lang: Language): SupportedLanguage {
  if (lang === 'auto') return getSystemLanguage();
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) return lang as SupportedLanguage;
  return 'zh';
}

export const I18nProvider: React.FC<I18nProviderProps> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>('auto');

  const systemLanguage = getSystemLanguage();
  const resolvedLanguage = resolveLanguage(language);

  // 从存储加载语言设置
  useEffect(() => {
    loadLanguage();
  }, []);

  // 语言变化时通知 i18next
  useEffect(() => {
    i18n.changeLanguage(resolvedLanguage);
  }, [resolvedLanguage]);

  const loadLanguage = async () => {
    try {
      const saved = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (
        saved &&
        (saved === 'auto' || (SUPPORTED_LANGUAGES as readonly string[]).includes(saved))
      ) {
        setLanguageState(saved as Language);
      }
    } catch (error) {
      console.error('Failed to load language:', error);
    }
  };

  const setLanguage = useCallback(async (lang: Language) => {
    setLanguageState(lang);
    try {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch (error) {
      console.error('Failed to save language:', error);
    }
  }, []);

  return (
    <I18nContext.Provider value={{ language, resolvedLanguage, systemLanguage, setLanguage }}>
      {children}
    </I18nContext.Provider>
  );
};
