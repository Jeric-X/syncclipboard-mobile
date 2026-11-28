import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  AppState,
  StyleSheet,
  Alert,
  Linking,
  ToastAndroid,
  StatusBar,
  View,
  Platform,
} from 'react-native';
import { clearSharedPayloads, getSharedPayloads } from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ThemeProvider } from './src/contexts/ThemeContext';
import { I18nProvider } from './src/contexts/I18nContext';
import i18n from '@/i18n';
import { DirectShareReceiveScreen } from './src/screens/DirectShareReceiveScreen';
import { takeSharedImage } from './src/services/clipboard/incomingSharedImage';
import { AppNavigator } from './src/navigation/AppNavigator';
import { QuickTileLoadingScreen } from './src/screens/QuickTileLoadingScreen';
import { ProcessTextScreen } from './src/screens/ProcessTextScreen';
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
  if (url.startsWith(QUICK_UPLOAD_URL)) {
    return { isQuickTile: true, fromForeground, direction: SyncDirection.Upload };
  }
  if (url.startsWith(QUICK_DOWNLOAD_URL)) {
    return { isQuickTile: true, fromForeground, direction: SyncDirection.Download };
  }
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
  const shareSequence = useRef(0);
  const androidShareOpen = useRef(false);
  const activeImage = useRef<ReturnType<typeof takeSharedImage> | undefined>(undefined);
  const [shareRequest, setShareRequest] = useState<{
    id: number;
    text?: string;
    image?: ReturnType<typeof takeSharedImage>;
  } | null>(null);

  useEffect(
    () => () => {
      ++shareSequence.current;
      activeImage.current?.dispose();
    },
    []
  );
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

  const openSharedContent = useCallback(async () => {
    if (Platform.OS === 'android') {
      if (androidShareOpen.current) return;
      androidShareOpen.current = true;
      await runOverlayNetworkPreflight();
      setShareRequest({ id: 0 });
      return;
    }
    let text: string | undefined;
    let image: ReturnType<typeof takeSharedImage> | undefined;
    if (Platform.OS === 'ios') {
      let payloads: ReturnType<typeof getSharedPayloads>;
      try {
        payloads = getSharedPayloads();
      } catch (error) {
        console.warn('[App] Could not read incoming share:', error);
        return;
      }
      // 附图的分享优先传图。只有文字和网址时保留来源顺序，例如网页选中文字。
      const payload =
        payloads.find((item) => item.shareType === 'image') ??
        payloads.find((item) => item.shareType === 'text' || item.shareType === 'url');
      if (!payload) return;
      if (payload.shareType === 'image') {
        try {
          image = takeSharedImage(payload.value, payload.mimeType);
        } catch (error) {
          clearSharedPayloads();
          Alert.alert(i18n.t('shareReceive.failed'), String(error));
          return;
        }
      } else if (payload.shareType === 'text' || payload.shareType === 'url') {
        text = payload.value;
      } else {
        return;
      }
      clearSharedPayloads();
    }
    const id = ++shareSequence.current;
    setShareRequest(null);
    activeImage.current?.dispose();
    activeImage.current = image;
    await runOverlayNetworkPreflight();
    if (id === shareSequence.current) setShareRequest({ id, text, image });
  }, []);

  const displayedShareId = shareRequest?.id;
  const closeSharedContent = useCallback(() => {
    if (Platform.OS === 'ios' && displayedShareId !== shareSequence.current) return;
    androidShareOpen.current = false;
    setShareRequest(null);
    activeImage.current?.dispose();
    activeImage.current = undefined;
    if (Platform.OS === 'android') moveTaskToBack();
  }, [displayedShareId]);

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
      if (Platform.OS === 'android' && config?.debugUrlScheme) {
        ToastAndroid.show(`getInitialURL: ${url ?? 'null'}`, ToastAndroid.LONG);
      }
      if (isShareIntentUrl(url)) {
        setAppMode('home');
        if (Platform.OS !== 'ios') await openSharedContent();
        return;
      }
      const { isQuickTile, fromForeground, direction } = parseQuickTileUrl(url);
      // 同步运行时由进程入口管理，此处只负责显示主界面。
      setAppMode('home');
      if (isQuickTile) {
        await runOverlayNetworkPreflight();
        // fg=1 完成后留在 app，fg=0/无fg 完成后退出
        setQuickActionOverlay({ direction, exitAfterSync: !fromForeground });
      }
    });

    // Hot start: app already running, receives URL deep link event
    const urlSub = Linking.addEventListener('url', ({ url }) => {
      if (Platform.OS === 'android' && config?.debugUrlScheme) {
        ToastAndroid.show(`addEventListener url: ${url ?? 'null'}`, ToastAndroid.LONG);
      }
      if (isShareIntentUrl(url)) {
        void openSharedContent();
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

    // 扩展先写 App Group 再唤起主 App。即使链接早于 RN 监听器，仍可恢复本次分享。
    const resumeSub =
      Platform.OS === 'ios'
        ? AppState.addEventListener('change', (state) => {
            if (state === 'active') void openSharedContent();
          })
        : undefined;
    if (Platform.OS === 'ios') void openSharedContent();
    return () => {
      urlSub.remove();
      resumeSub?.remove();
    };
  }, [isLoaded, config?.debugUrlScheme, openSharedContent]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemeProvider>
        <I18nProvider>
          <ThemedStatusBar />
          {appMode === 'checking' ? null : <AppNavigator />}
          {shareRequest && (
            <View key={shareRequest.id} style={StyleSheet.absoluteFill}>
              {shareRequest.image ? (
                <DirectShareReceiveScreen
                  shareData={shareRequest.image.data}
                  onComplete={closeSharedContent}
                />
              ) : shareRequest.text !== undefined ? (
                <ProcessTextScreen text={shareRequest.text} onComplete={closeSharedContent} />
              ) : (
                <ShareReceiveScreen onComplete={closeSharedContent} />
              )}
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
                    // 将快捷操作任务移到后台，保留返回主界面的导航状态
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
