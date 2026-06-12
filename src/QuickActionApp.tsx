/**
 * QuickActionApp
 * Lightweight RN root component for the transparent QuickActionActivity.
 * Renders only a semi-transparent overlay with the sync progress card.
 * Registered as "quickAction" in the AppRegistry (separate from "main").
 *
 * Supports three modes:
 * 1. Quick tile mode (direction): download/upload from quick settings tile
 * 2. Process text mode (text): upload selected text from Android text selection menu
 * 3. Share mode (shareMode): receive shared content from other apps (Android only)
 */

import React, { useCallback, useEffect } from 'react';
import { StyleSheet, StatusBar, Platform, BackHandler } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider } from './contexts/ThemeContext';
import { I18nProvider } from './contexts/I18nContext';
import { QuickTileLoadingScreen } from './screens/QuickTileLoadingScreen';
import { ProcessTextScreen } from './screens/ProcessTextScreen';
import { DirectShareReceiveScreen } from './screens/DirectShareReceiveScreen';
import { SyncDirection } from './types/sync';
import { useSettingsStore } from './stores';
import { initLogger } from './utils/Logger';
import { longRunningTaskManager } from './longRunningTask/LongRunningTaskManager';

export interface ShareData {
  type: 'text' | 'file' | 'multiple';
  text?: string;
  uri?: string;
  uris?: string[];
  mimeType?: string;
  fileName?: string;
  /** 多文件分享时每个文件的文件名 */
  fileNames?: string[];
}

interface QuickActionAppProps {
  direction?: string;
  text?: string;
  shareMode?: boolean;
  shareData?: ShareData;
  systemTheme?: 'light' | 'dark';
}

export default function QuickActionApp({
  direction,
  text,
  shareMode,
  shareData,
  systemTheme,
}: QuickActionAppProps) {
  const syncDirection = direction === 'upload' ? SyncDirection.Upload : SyncDirection.Download;
  const { loadConfig, isLoaded } = useSettingsStore();

  useEffect(() => {
    initLogger();
  }, []);

  useEffect(() => {
    if (!isLoaded) {
      loadConfig();
    }
  }, [isLoaded, loadConfig]);

  // 启动所有后台服务（冷启动 / 快速操作时保证后台任务正常运行）
  useEffect(() => {
    if (!isLoaded || Platform.OS !== 'android') return;
    longRunningTaskManager.startAll().catch(() => {});
  }, [isLoaded]);

  const handleComplete = useCallback(() => {
    BackHandler.exitApp();
  }, []);

  if (!isLoaded) return null;

  // Share mode: receive shared content from other apps (direct data, not via expo-sharing)
  if (shareMode && shareData) {
    return (
      <GestureHandlerRootView style={styles.container}>
        <I18nProvider>
          <ThemeProvider systemColorSchemeOverride={systemTheme}>
            <StatusBar backgroundColor="transparent" translucent barStyle="light-content" />
            <DirectShareReceiveScreen
              shareData={shareData}
              onComplete={handleComplete}
              overlayMode
            />
          </ThemeProvider>
        </I18nProvider>
      </GestureHandlerRootView>
    );
  }

  // Process text mode: upload selected text
  if (text) {
    return (
      <GestureHandlerRootView style={styles.container}>
        <I18nProvider>
          <ThemeProvider systemColorSchemeOverride={systemTheme}>
            <StatusBar backgroundColor="transparent" translucent barStyle="light-content" />
            <ProcessTextScreen text={text} onComplete={handleComplete} overlayMode />
          </ThemeProvider>
        </I18nProvider>
      </GestureHandlerRootView>
    );
  }

  // Quick tile mode: download/upload
  return (
    <GestureHandlerRootView style={styles.container}>
      <I18nProvider>
        <ThemeProvider systemColorSchemeOverride={systemTheme}>
          <StatusBar backgroundColor="transparent" translucent barStyle="light-content" />
          <QuickTileLoadingScreen
            direction={syncDirection}
            onLoadingComplete={handleComplete}
            overlayMode
          />
        </ThemeProvider>
      </I18nProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
