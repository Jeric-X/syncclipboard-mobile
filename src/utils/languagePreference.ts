export const LANGUAGE_STORAGE_KEY = '@syncclipboard:language';

/** 保留 auto 偏好，兼容旧版区域代码；未知值按跟随系统处理。 */
export function normalizeLanguagePreference(saved: string | null): 'zh' | 'en' | 'auto' {
  const preferred = saved?.toLowerCase().replace('_', '-').split('-')[0];
  return preferred === 'zh' || preferred === 'en' ? preferred : 'auto';
}

/** 将保存的语言偏好（包括旧区域代码）解析为支持的语言，auto/缺省跟随系统。 */
export function resolveLanguagePreference(
  saved: string | null,
  system: string | null
): 'zh' | 'en' {
  const preferred = normalizeLanguagePreference(saved);
  if (preferred === 'zh' || preferred === 'en') return preferred;
  const systemLanguage = system?.toLowerCase().replace('_', '-').split('-')[0] ?? 'zh';
  return systemLanguage === 'zh' ? 'zh' : 'en';
}
