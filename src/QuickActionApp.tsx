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

import React, { useCallback, useEffect, useState } from 'react';
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
import { networkAutoSwitchService } from './services/NetworkAutoSwitchService';

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
  const [isRuntimeReady, setIsRuntimeReady] = useState(Platform.OS !== 'android');

  useEffect(() => {
    initLogger();
  }, []);

  useEffect(() => {
    if (!isLoaded) {
      loadConfig();
    }
  }, [isLoaded, loadConfig]);

  // 公共入口先完成服务器自动选择，再渲染快捷下载、上传、文本处理或分享页面。
  useEffect(() => {
    if (!isLoaded || Platform.OS !== 'android') return;

    let cancelled = false;
    const initializeRuntime = async (): Promise<void> => {
      try {
        await networkAutoSwitchService.ensureCurrentServer();
      } catch (error) {
        console.error('[QuickActionApp] Network auto-switch preflight failed:', error);
      }

      if (cancelled) return;
      longRunningTaskManager.startAll().catch(() => {});
      setIsRuntimeReady(true);
    };

    initializeRuntime().catch(() => {
      if (!cancelled) setIsRuntimeReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [isLoaded]);

  const handleComplete = useCallback(() => {
    BackHandler.exitApp();
  }, []);

  if (!isLoaded || !isRuntimeReady) return null;

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
