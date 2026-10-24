/**
 * SettingsSection - 设置组容器组件
 * 渲染设置组标题和卡片容器
 * 自动为最后一个子元素设置 showBorder={false}
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

export interface SettingsSectionProps {
  /** 组标题 */
  title: string;

  /** 组内设置共用的说明 */
  description?: string;

  /** 标题右侧内容，如刷新按钮 */
  headerRight?: React.ReactNode;

  /** 设置项内容 */
  children: React.ReactNode;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  description,
  headerRight,
  children,
}) => {
  const { theme } = useTheme();

  // 为最后一个子元素自动设置 showBorder={false}
  const renderChildren = () => {
    const childrenArray = React.Children.toArray(children);
    const lastChildIndex = childrenArray.length - 1;

    return childrenArray.map((child, index) => {
      if (React.isValidElement(child) && index === lastChildIndex) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return React.cloneElement(child as React.ReactElement<any>, { showBorder: false });
      }
      return child;
    });
  };

  return (
    <View style={styles.section}>
      <View style={[styles.sectionHeaderBase, headerRight ? styles.sectionHeaderRow : undefined]}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{title}</Text>
        {headerRight}
      </View>
      {description && (
        <Text style={[styles.sectionDescription, { color: theme.colors.textTertiary }]}>
          {description}
        </Text>
      )}
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.divider,
          },
        ]}
      >
        {renderChildren()}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginTop: 20,
  },
  sectionHeaderBase: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionDescription: {
    marginHorizontal: 16,
    marginBottom: 8,
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
  },
});
