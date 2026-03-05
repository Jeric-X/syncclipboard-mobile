import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet, Platform, Linking } from 'react-native';
import { useEffect } from 'react';
import { ThemeProvider } from './src/contexts/ThemeContext';
import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  useEffect(() => {
    // Handle app launch from Quick Settings Tile
    const handleInitialURL = async () => {
      if (Platform.OS === 'android') {
        try {
          const url = await Linking.getInitialURL();
          if (url) {
            console.log('[QuickSettingsTile] App launched with URL:', url);
          }
          
          // Log that app has been launched (useful for Quick Settings Tile)
          console.log('[QuickSettingsTile] App initialized');
        } catch (error) {
          console.error('[QuickSettingsTile] Error checking initial URL:', error);
        }
      }
    };

    handleInitialURL();

    // Listen for URL events while app is running
    const subscription = Linking.addEventListener('url', (event) => {
      console.log('[QuickSettingsTile] App opened with URL event:', event.url);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemeProvider>
        <AppNavigator />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
