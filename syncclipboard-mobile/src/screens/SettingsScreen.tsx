/**
 * 设置页面
 * 提供主题切换功能
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import type { ThemeMode } from '@/theme';

export const SettingsScreen = () => {
  const { theme, themeMode, setThemeMode } = useTheme();

  const themeOptions: { label: string; value: ThemeMode }[] = [
    { label: '跟随系统', value: 'auto' },
    { label: '浅色模式', value: 'light' },
    { label: '深色模式', value: 'dark' },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView style={styles.scrollView}>
        {/* 主题设置部分 */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>外观</Text>

          <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.cardTitle, { color: theme.colors.text }]}>主题模式</Text>

            {themeOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.optionItem, { borderBottomColor: theme.colors.divider }]}
                onPress={() => setThemeMode(option.value)}
              >
                <Text style={[styles.optionLabel, { color: theme.colors.text }]}>
                  {option.label}
                </Text>
                {themeMode === option.value && (
                  <View style={[styles.checkmark, { backgroundColor: theme.colors.primary }]}>
                    <Text style={[styles.checkmarkIcon, { color: theme.colors.surface }]}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 应用信息部分 */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>关于</Text>

          <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <View style={[styles.infoRow, { borderBottomColor: theme.colors.divider }]}>
              <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>版本</Text>
              <Text style={[styles.infoValue, { color: theme.colors.text }]}>1.0.0 (Beta)</Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>
                当前主题
              </Text>
              <Text style={[styles.infoValue, { color: theme.colors.text }]}>
                {theme.isDark ? '深色' : '浅色'}
              </Text>
            </View>
          </View>
        </View>

        {/* 占位提示 */}
        <View style={styles.placeholderContainer}>
          <Text style={[styles.placeholderText, { color: theme.colors.textTertiary }]}>
            更多设置功能即将到来...
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  optionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionLabel: {
    fontSize: 16,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkIcon: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: {
    fontSize: 16,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '500',
  },
  placeholderContainer: {
    marginTop: 40,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
