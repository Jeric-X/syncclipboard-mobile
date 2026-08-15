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

const QUICK_UPLOAD_URL = 'syncclipboard://quick-upload';
const QUICK_DOWNLOAD_URL = 'syncclipboard://quick-download';

function parseQuickTileUrl(url: string | null): {
  isQuickTile: boolean;
  fromForeground: boolean;
  direction: SyncDirection;
} {
  if (!url) return { isQuickTile: false, fromForeground: false, direction: SyncDirection.Download };
  const fromForeground = url.includes('fg=1');
  // Check upload first — its URL is a superset of the download prefix
  if (url.startsWith(QUICK_UPLOAD_URL))
    return { isQuickTile: true, fromForeground, direction: SyncDirection.Upload };
  if (url.startsWith(QUICK_DOWNLOAD_URL))
    return { isQuickTile: true, fromForeground, direction: SyncDirection.Download };
  return { isQuickTile: false, fromForeground: false, direction: SyncDirection.Download };
}

function isShareIntentUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === 'expo-sharing';
  } catch {
    return false;
  }
}

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
          {appMode === 'checking' ? null : <AppNavigator />}
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
