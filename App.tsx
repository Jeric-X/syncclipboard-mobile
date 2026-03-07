import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, Linking, BackHandler } from 'react-native';
import { useEffect, useState } from 'react';
import { ThemeProvider } from './src/contexts/ThemeContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { QuickTileLoadingScreen } from './src/screens/QuickTileLoadingScreen';
import { ShareReceiveScreen } from './src/screens/ShareReceiveScreen';
import { SyncDirection } from './src/types/sync';

const QUICK_TILE_UPLOAD_URL = 'syncclipboard://quick-tile-upload';
const QUICK_TILE_DOWNLOAD_URL = 'syncclipboard://quick-tile';

function parseQuickTileUrl(url: string | null): {
  isQuickTile: boolean;
  fromForeground: boolean;
  direction: SyncDirection;
} {
  if (!url) return { isQuickTile: false, fromForeground: false, direction: SyncDirection.Download };
  const fromForeground = url.includes('fg=1');
  // Check upload first — its URL is a superset of the download prefix
  if (url.startsWith(QUICK_TILE_UPLOAD_URL))
    return { isQuickTile: true, fromForeground, direction: SyncDirection.Upload };
  if (url.startsWith(QUICK_TILE_DOWNLOAD_URL))
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

type AppMode = 'home' | 'quick_tile_loading' | 'share_receive';

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('home');
  const [shouldExitAfterSync, setShouldExitAfterSync] = useState(false);
  const [syncDirection, setSyncDirection] = useState<SyncDirection>(SyncDirection.Download);

  useEffect(() => {
    // Cold start: app launched via URL scheme
    Linking.getInitialURL().then((url) => {
      if (isShareIntentUrl(url)) {
        setAppMode('share_receive');
        return;
      }
      const { isQuickTile, fromForeground, direction } = parseQuickTileUrl(url);
      if (isQuickTile) {
        setShouldExitAfterSync(!fromForeground);
        setSyncDirection(direction);
        setAppMode('quick_tile_loading');
      }
    });

    // Hot start: app already running, receives URL deep link event
    const urlSub = Linking.addEventListener('url', ({ url }) => {
      if (isShareIntentUrl(url)) {
        setAppMode('share_receive');
        return;
      }
      const { isQuickTile, fromForeground, direction } = parseQuickTileUrl(url);
      if (isQuickTile) {
        setShouldExitAfterSync(!fromForeground);
        setSyncDirection(direction);
        setAppMode('quick_tile_loading');
      }
    });

    return () => urlSub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemeProvider>
        {appMode === 'share_receive' ? (
          <ShareReceiveScreen
            onComplete={() => {
              setAppMode('home');
              BackHandler.exitApp();
            }}
          />
        ) : appMode === 'quick_tile_loading' ? (
          <QuickTileLoadingScreen
            direction={syncDirection}
            onLoadingComplete={() => {
              setAppMode('home');
              if (shouldExitAfterSync) {
                BackHandler.exitApp();
              }
            }}
          />
        ) : (
          <AppNavigator />
        )}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
