export const LANGUAGE_STORAGE_KEY = '@syncclipboard:language';

/** 将保存的语言偏好（包括旧区域代码）解析为支持的语言，auto/缺省跟随系统。 */
export function resolveLanguagePreference(
  saved: string | null,
  system: string | null
): 'zh' | 'en' {
  const preferred = saved?.toLowerCase().replace('_', '-').split('-')[0];
  if (preferred === 'zh' || preferred === 'en') return preferred;
  const systemLanguage = system?.toLowerCase().replace('_', '-').split('-')[0] ?? 'zh';
  return systemLanguage === 'zh' ? 'zh' : 'en';
}
