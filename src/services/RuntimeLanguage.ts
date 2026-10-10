import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n, { type Language, type SupportedLanguage } from '../i18n';
import {
  LANGUAGE_STORAGE_KEY,
  normalizeLanguagePreference,
  resolveLanguagePreference,
} from '../utils/languagePreference';

interface RuntimeLanguageState {
  language: Language;
  resolvedLanguage: SupportedLanguage;
  systemLanguage: SupportedLanguage;
}

let state: RuntimeLanguageState = {
  language: 'auto',
  resolvedLanguage: 'en',
  systemLanguage: 'en',
};
const listeners = new Set<() => void>();
let changes = Promise.resolve();

/** 向所有 UI Provider 提供同一份语言状态。 */
export const getRuntimeLanguageState = (): RuntimeLanguageState => state;

/** 订阅语言变化；多个 React 根共享状态，不重复读取存储。 */
export function subscribeRuntimeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function applyLanguage(language: Language): Promise<void> {
  const systemLanguage = resolveLanguagePreference('auto', getLocales()[0]?.languageCode ?? null);
  const resolvedLanguage = resolveLanguagePreference(language, systemLanguage);
  if (i18n.resolvedLanguage !== resolvedLanguage) await i18n.changeLanguage(resolvedLanguage);
  if (
    state.language === language &&
    state.resolvedLanguage === resolvedLanguage &&
    state.systemLanguage === systemLanguage
  )
    return;
  state = { language, resolvedLanguage, systemLanguage };
  listeners.forEach((listener) => listener());
}

/** 无 UI 时也读取与语言选择器相同的偏好；存储不可用时跟随系统。 */
export async function initializeRuntimeLanguage(): Promise<void> {
  let saved: string | null = null;
  try {
    saved = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch (error) {
    console.error('[RuntimeLanguage] Failed to load language:', error);
  }
  await applyLanguage(normalizeLanguagePreference(saved));
}

/** 串行保存并应用主动切换，失败不发布未保存的偏好，也不阻塞后续切换。 */
export function setRuntimeLanguage(language: Language): Promise<void> {
  const operation = changes
    .catch(() => {})
    .then(async () => {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      await applyLanguage(language);
    });
  changes = operation;
  return operation;
}

/** 系统语言变化时刷新 auto，显式选择的语言保持不变。 */
export function refreshRuntimeSystemLanguage(): Promise<void> {
  const operation = changes.catch(() => {}).then(() => applyLanguage(state.language));
  changes = operation;
  return operation;
}
