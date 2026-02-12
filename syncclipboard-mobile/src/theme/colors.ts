/**
 * 主题颜色定义
 * 包含亮色和暗色两种模式的颜色配置
 */

export const lightColors = {
  // 主色调
  primary: '#007AFF',
  primaryLight: '#4DA2FF',
  primaryDark: '#0051D5',

  // 次要色
  secondary: '#5AC8FA',
  secondaryLight: '#8ADDFF',
  secondaryDark: '#00A0E0',

  // 成功/错误/警告
  success: '#34C759',
  error: '#FF3B30',
  warning: '#FF9500',
  info: '#5AC8FA',

  // 背景色
  background: '#F2F2F7',
  surface: '#FFFFFF',
  card: '#FFFFFF',

  // 文本色
  text: '#000000',
  textSecondary: '#3C3C43',
  textTertiary: '#8E8E93',
  textDisabled: '#C7C7CC',

  // 边框
  border: '#C6C6C8',
  borderLight: '#E5E5EA',

  // 分隔线
  divider: '#E5E5EA',

  // 叠加层
  overlay: 'rgba(0, 0, 0, 0.3)',
  backdrop: 'rgba(0, 0, 0, 0.5)',

  // 状态色
  active: '#007AFF',
  inactive: '#C7C7CC',
  disabled: '#E5E5EA',

  // Tab Bar
  tabBarBackground: '#F9F9F9',
  tabBarBorder: '#E5E5EA',
  tabBarActive: '#007AFF',
  tabBarInactive: '#8E8E93',
};

export const darkColors = {
  // 主色调
  primary: '#0A84FF',
  primaryLight: '#409CFF',
  primaryDark: '#006CE0',

  // 次要色
  secondary: '#64D2FF',
  secondaryLight: '#8ADDFF',
  secondaryDark: '#32BEFF',

  // 成功/错误/警告
  success: '#30D158',
  error: '#FF453A',
  warning: '#FF9F0A',
  info: '#64D2FF',

  // 背景色
  background: '#000000',
  surface: '#1C1C1E',
  card: '#2C2C2E',

  // 文本色
  text: '#FFFFFF',
  textSecondary: '#EBEBF5',
  textTertiary: '#8E8E93',
  textDisabled: '#48484A',

  // 边框
  border: '#38383A',
  borderLight: '#48484A',

  // 分隔线
  divider: '#38383A',

  // 叠加层
  overlay: 'rgba(255, 255, 255, 0.1)',
  backdrop: 'rgba(0, 0, 0, 0.7)',

  // 状态色
  active: '#0A84FF',
  inactive: '#48484A',
  disabled: '#3A3A3C',

  // Tab Bar
  tabBarBackground: '#1C1C1E',
  tabBarBorder: '#38383A',
  tabBarActive: '#0A84FF',
  tabBarInactive: '#8E8E93',
};

export type ColorScheme = typeof lightColors;
