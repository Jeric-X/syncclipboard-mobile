import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, Linking, ToastAndroid, StatusBar, View, Platform } from 'react-native';
import { useEffect, useState } from 'react';
import { ThemeProvider } from './src/contexts/ThemeContext';
import { I18nProvider } from './src/contexts/I18nContext';
import '@/i18n';
import { AppNavigator } from './src/navigation/AppNavigator';
import { QuickTileLoadingScreen } from './src/screens/QuickTileLoadingScreen';
import { ShareReceiveScreen } from './src/screens/ShareReceiveScreen';
import { SyncDirection } from './src/types/sync';
import { useSettingsStore } from './src/stores';
import { initLogger } from './src/utils/Logger';
import { useTheme } from './src/hooks/useTheme';
import { setDynamicShortcuts } from 'shortcut';
import { moveTaskToBack, setExcludeFromRecents } from 'native-util';
import { networkAutoSwitchService } from './src/services/NetworkAutoSwitchService';
import {
  isShareIntentUrl,
  parseQuickTileUrl,
  shouldEnableAutoUpdateCheck,
} from './src/utils/appLaunch';

async function runOverlayNetworkPreflight(): Promise<void> {
  try {
    await networkAutoSwitchService.ensureCurrentServer();
  } catch (error) {
    console.error('[App] Overlay network auto-switch preflight failed:', error);
  }
}

type AppMode = 'checking' | 'home';

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('checking');
  const [autoUpdateCheckEnabled, setAutoUpdateCheckEnabled] = useState(false);
  // 快速操作覆盖层：始终以 overlay 形式显示，不卸载 AppNavigator/HomeScreen
  const [shareReceiveOverlay, setShareReceiveOverlay] = useState(false);
  const [quickActionOverlay, setQuickActionOverlay] = useState<{
    direction: SyncDirection;
    exitAfterSync: boolean;
  } | null>(null);
  const { config, loadConfig, isLoaded } = useSettingsStore();

  useEffect(() => {
    initLogger();
    setDynamicShortcuts();
  }, []);

  useEffect(() => {
    if (!isLoaded) {
      loadConfig();
    }
  }, [isLoaded, loadConfig]);

  // 应用启动时恢复「最近任务隐藏」设置（仅 Android）
  useEffect(() => {
    if (!isLoaded) return;
    if (Platform.OS === 'android' && config?.hideFromRecents) {
      setExcludeFromRecents(true);
    }
  }, [isLoaded, config?.hideFromRecents]);

  useEffect(() => {
    if (!isLoaded) return;

    // Cold start: app launched via URL scheme
    // 冷启动时 getInitialURL 可能为空，需要重试一次
    const getInitialUrlWithRetry = async (): Promise<string | null> => {
      let url = await Linking.getInitialURL();
      if (!url) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        url = await Linking.getInitialURL();
      }
      return url;
    };

    getInitialUrlWithRetry().then(async (url) => {
      if (config?.debugUrlScheme) {
        ToastAndroid.show(`getInitialURL: ${url ?? 'null'}`, ToastAndroid.LONG);
      }
      if (isShareIntentUrl(url)) {
        setAppMode('home');
        await runOverlayNetworkPreflight();
        setShareReceiveOverlay(true);
        return;
      }
      const { isQuickTile, fromForeground, direction } = parseQuickTileUrl(url);
      // 始终进入 home 模式（挂载 AppNavigator/HomeScreen 以启动后台任务）
      setAppMode('home');
      if (isQuickTile) {
        await runOverlayNetworkPreflight();
        // fg=1 完成后留在 app，fg=0/无fg 完成后退出
        setQuickActionOverlay({ direction, exitAfterSync: !fromForeground });
      } else if (shouldEnableAutoUpdateCheck(url)) {
        // URL 解析完成且不是 overlay 冷启动，才允许首页自动检查更新。
        setAutoUpdateCheckEnabled(true);
      }
    });

    // Hot start: app already running, receives URL deep link event
    const urlSub = Linking.addEventListener('url', ({ url }) => {
      if (config?.debugUrlScheme) {
        ToastAndroid.show(`addEventListener url: ${url ?? 'null'}`, ToastAndroid.LONG);
      }
      if (isShareIntentUrl(url)) {
        runOverlayNetworkPreflight().then(() => setShareReceiveOverlay(true));
        return;
      }
      const { isQuickTile, fromForeground, direction } = parseQuickTileUrl(url);
      if (isQuickTile) {
        runOverlayNetworkPreflight().then(() => {
          // fg=1 完成后留在 app，fg=0/无fg 完成后退出
          setQuickActionOverlay({ direction, exitAfterSync: !fromForeground });
        });
      }
    });

    return () => urlSub.remove();
  }, [isLoaded, config?.debugUrlScheme]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemeProvider>
        <I18nProvider>
          <ThemedStatusBar />
          {appMode === 'checking' ? null : (
            <AppNavigator autoUpdateCheckEnabled={autoUpdateCheckEnabled} />
          )}
          {shareReceiveOverlay && (
            <View style={StyleSheet.absoluteFill}>
              <ShareReceiveScreen
                onComplete={() => {
                  setShareReceiveOverlay(false);
                  // 使用 moveTaskToBack 而非 exitApp，保持 Activity 存活以维持后台任务
                  moveTaskToBack();
                }}
              />
            </View>
          )}
          {quickActionOverlay && (
            <View style={StyleSheet.absoluteFill}>
              <QuickTileLoadingScreen
                direction={quickActionOverlay.direction}
                onLoadingComplete={() => {
                  const shouldExit = quickActionOverlay.exitAfterSync;
                  setQuickActionOverlay(null);
                  if (shouldExit) {
                    // 使用 moveTaskToBack 而非 exitApp，保持 Activity 存活以维持后台任务
                    moveTaskToBack();
                  }
                }}
                overlayMode
              />
            </View>
          )}
        </I18nProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function ThemedStatusBar() {
  const { theme } = useTheme();
  return (
    <StatusBar
      barStyle={theme.isDark ? 'light-content' : 'dark-content'}
      backgroundColor={theme.colors.surface}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
