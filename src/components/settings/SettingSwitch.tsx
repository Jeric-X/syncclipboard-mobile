/**
 * SettingSwitch - 开关设置项
 * 封装 Switch 控件，提供统一的样式配置
 */

import React from 'react';
import { SettingItem, SettingItemProps } from './SettingItem';
import { ThemedSwitch } from './ThemedSwitch';

export interface SettingSwitchProps extends Omit<SettingItemProps, 'children'> {
  /** 开关当前值 */
  value: boolean;

  /** 值变化回调 */
  onChange: (value: boolean) => void;
}

export const SettingSwitch: React.FC<SettingSwitchProps> = ({
  value,
  onChange,
  disabled = false,
  ...rest
}) => {
  return (
    <SettingItem disabled={disabled} {...rest}>
      <ThemedSwitch value={value} onValueChange={onChange} disabled={disabled} />
    </SettingItem>
  );
};
