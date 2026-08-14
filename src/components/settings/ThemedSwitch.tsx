import React from 'react';
import { Switch, type SwitchProps } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

export type ThemedSwitchProps = SwitchProps;

/** 基础主题开关，不包含设置项的行布局。 */
export const ThemedSwitch: React.FC<ThemedSwitchProps> = ({ value = false, ...props }) => {
  const { theme } = useTheme();

  return (
    <Switch
      {...props}
      value={value}
      trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
      thumbColor={value ? theme.colors.surface : theme.colors.textTertiary}
    />
  );
};
