/**
 * SettingItem - 设置项基础组件
 * 提供统一的设置项布局（左侧信息 + 右侧控件）
 */

import React from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

export interface SettingItemProps {
  /** 主标签，可选 */
  label?: string;

  /** 描述文字 */
  description?: string;

  /** 可点击的描述链接 */
  descriptionLink?: {
    text: string;
    onPress: () => void;
  };

  /** 禁用状态，影响文字颜色 */
  disabled?: boolean;

  /** 是否显示底部分隔线，默认 true */
  showBorder?: boolean;

  /** 右侧控件，可选 */
  children?: React.ReactNode;

  /** 整行可点击时的回调 */
  onPress?: () => void;

  /** 按压反馈方式，highlight 不会降低右侧控件透明度 */
  pressFeedback?: 'opacity' | 'highlight';
}

export const SettingItem: React.FC<SettingItemProps> = ({
  label,
  description,
  descriptionLink,
  disabled = false,
  showBorder = true,
  children,
  onPress,
  pressFeedback = 'opacity',
}) => {
  const { theme } = useTheme();

  const content = (
    <>
      <View style={styles.settingInfo}>
        {label && (
          <Text
            style={[
              styles.settingLabel,
              { color: disabled ? theme.colors.textTertiary : theme.colors.text },
            ]}
          >
            {label}
          </Text>
        )}
        {description && (
          <Text style={[styles.settingDescription, { color: theme.colors.textTertiary }]}>
            {description}
          </Text>
        )}
        {descriptionLink && (
          <Text
            style={[styles.settingDescription, { color: theme.colors.primary }]}
            onPress={(event) => {
              event.stopPropagation();
              descriptionLink.onPress();
            }}
          >
            {descriptionLink.text}
          </Text>
        )}
      </View>
      {children}
    </>
  );

  const containerStyle = [
    styles.settingRow,
    { borderBottomColor: theme.colors.divider },
    !showBorder && styles.noBorder,
  ];

  if (onPress) {
    if (pressFeedback === 'highlight') {
      return (
        <Pressable
          style={({ pressed }) => [
            containerStyle,
            pressed && { backgroundColor: theme.colors.borderLight },
          ]}
          onPress={onPress}
        >
          {content}
        </Pressable>
      );
    }

    return (
      <TouchableOpacity style={containerStyle} onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={containerStyle}>{content}</View>;
};

const styles = StyleSheet.create({
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noBorder: {
    borderBottomWidth: 0,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
});
