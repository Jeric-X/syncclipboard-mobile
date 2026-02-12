/**
 * 主题系统
 * 导出主题配置、类型和工具函数
 */

import { lightColors, darkColors, type ColorScheme } from './colors';

export type ThemeMode = 'light' | 'dark' | 'auto';

export interface Theme {
  mode: ThemeMode;
  colors: ColorScheme;
  isDark: boolean;
}

/**
 * 创建主题对象
 */
export const createTheme = (mode: ThemeMode, systemColorScheme: 'light' | 'dark'): Theme => {
  const isDark = mode === 'auto' ? systemColorScheme === 'dark' : mode === 'dark';

  return {
    mode,
    colors: isDark ? darkColors : lightColors,
    isDark,
  };
};

// 导出颜色
export { lightColors, darkColors };
export type { ColorScheme };
