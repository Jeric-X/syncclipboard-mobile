/**
 * ServiceRestartApp
 * 恢复失败时由用户点击通知打开的备用入口；正常系统重启由 Headless JS 直接恢复。
 * 显示一个短暂的"✓ 服务已恢复"提示，0.5 秒后自动关闭。
 * 注册为 "serviceRestart"（独立于 "main" 入口）。
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, BackHandler, StatusBar, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from './contexts/ThemeContext';
import { I18nProvider } from './contexts/I18nContext';
import { useSettingsStore } from './stores';
import { initLogger } from './utils/Logger';
import { startServiceRuntime } from './services/ServiceRuntime';
import { useTranslation } from 'react-i18next';

interface ServiceRestartAppProps {
  systemTheme?: 'light' | 'dark';
}

function ServiceRestartContent({ systemTheme }: ServiceRestartAppProps) {
  const { t } = useTranslation();
  const { loadConfig, isLoaded } = useSettingsStore();
  const [ready, setReady] = useState(false);
  const isDark = systemTheme === 'dark';

  useEffect(() => {
    initLogger();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' && !isLoaded) {
      loadConfig();
    }
  }, [isLoaded, loadConfig]);

  // 启动所有后台服务（和主界面一致）
  useEffect(() => {
    if (!isLoaded || Platform.OS !== 'android') return;

    startServiceRuntime().finally(() => setReady(true));
  }, [isLoaded]);

  // 自动关闭：短暂展示"服务已恢复"后退出，后台服务持续运行（JS 运行时由前台服务保持存活）
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      BackHandler.exitApp();
    }, 500);
    return () => clearTimeout(timer);
  }, [ready]);

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor="transparent" translucent barStyle="light-content" />
      <View style={[styles.card, isDark ? styles.cardDark : styles.cardLight]}>
        <Text style={[styles.icon]}>✓</Text>
        <Text style={[styles.text, isDark ? styles.textDark : styles.textLight]}>
          {t('syncStatus.serviceRestored')}
        </Text>
      </View>
    </View>
  );
}

export default function ServiceRestartApp({ systemTheme }: ServiceRestartAppProps) {
  return (
    <GestureHandlerRootView style={styles.root}>
      <I18nProvider>
        <ThemeProvider systemColorSchemeOverride={systemTheme}>
          <ServiceRestartContent systemTheme={systemTheme} />
        </ThemeProvider>
      </I18nProvider>
    </GestureHandlerRootView>
  );
}

const COLORS = {
  overlay: 'rgba(0, 0, 0, 0.3)',
  shadow: '#000',
  cardLight: '#ffffff',
  cardDark: '#2c2c2e',
  success: '#34c759',
  textLight: '#1c1c1e',
  textDark: '#f2f2f7',
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.overlay,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 16,
    gap: 10,
    elevation: 8,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  cardLight: {
    backgroundColor: COLORS.cardLight,
  },
  cardDark: {
    backgroundColor: COLORS.cardDark,
  },
  icon: {
    fontSize: 22,
    color: COLORS.success,
    fontWeight: 'bold',
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
  },
  textLight: {
    color: COLORS.textLight,
  },
  textDark: {
    color: COLORS.textDark,
  },
});
