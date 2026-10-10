import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from '../i18n';
import { LANGUAGE_STORAGE_KEY, resolveLanguagePreference } from '../utils/languagePreference';

/** 无 UI 时也读取与语言选择器相同的偏好；存储不可用时跟随系统。 */
export async function loadRuntimeLanguage(): Promise<'zh' | 'en'> {
  let saved: string | null = null;
  try {
    saved = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch (error) {
    console.error('[RuntimeLanguage] Failed to load language:', error);
  }
  return resolveLanguagePreference(saved, getLocales()[0]?.languageCode ?? null);
}

/** 必须在启动会发送通知或 Toast 的任务之前完成，不依赖 React Provider。 */
export async function initializeRuntimeLanguage(): Promise<void> {
  await i18n.changeLanguage(await loadRuntimeLanguage());
}
