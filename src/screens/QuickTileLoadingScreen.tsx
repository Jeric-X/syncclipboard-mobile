import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, ToastAndroid } from 'react-native';
import { SyncDirection } from '@/types/sync';
import { SyncManager } from '@/services/SyncManager';
import { useTheme } from '@/hooks/useTheme';

interface QuickTileLoadingScreenProps {
  direction: SyncDirection;
  onLoadingComplete: () => void;
}

type SyncState = 'loading' | 'success' | 'error';

export const QuickTileLoadingScreen: React.FC<QuickTileLoadingScreenProps> = ({
  direction,
  onLoadingComplete,
}) => {
  const { theme } = useTheme();
  const [syncState, setSyncState] = useState<SyncState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isUpload = direction === SyncDirection.Upload;

  useEffect(() => {
    const runSync = async () => {
      try {
        const syncMgr = SyncManager.getInstance();
        const result = await syncMgr.sync(direction);

        if (result.success) {
          const content = result.content;
          let toastMessage = isUpload ? '上传成功' : '同步成功';
          if (content) {
            if (content.type === 'Text' && content.text) {
              const preview = content.text.trim().replace(/\s+/g, ' ');
              toastMessage = preview.length > 40 ? preview.slice(0, 40) + '…' : preview;
            } else if (content.fileName) {
              toastMessage = content.fileName;
            }
          }
          ToastAndroid.show(toastMessage, ToastAndroid.SHORT);
          setSyncState('success');
          setTimeout(onLoadingComplete, 500);
        } else {
          throw new Error(result.error || (isUpload ? '上传失败' : '同步失败'));
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : isUpload
            ? '上传失败，请检查配置'
            : '同步失败，请检查配置';
        setErrorMessage(message);
        setSyncState('error');
        setTimeout(onLoadingComplete, 2000);
      }
    };

    runSync();
  }, [direction, onLoadingComplete, isUpload]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.content}>
        {syncState === 'loading' && (
          <>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[styles.statusText, { color: theme.colors.text }]}>
              {isUpload ? '正在上传剪贴板...' : '正在下载剪贴板...'}
            </Text>
          </>
        )}
        {syncState === 'success' && (
          <>
            <Text style={[styles.successIcon, { color: theme.colors.success }]}>✓</Text>
            <Text style={[styles.statusText, { color: theme.colors.text }]}>
              {isUpload ? '上传成功！' : '同步成功！'}
            </Text>
          </>
        )}
        {syncState === 'error' && (
          <>
            <Text style={[styles.errorIcon, { color: theme.colors.error }]}>✗</Text>
            <Text style={[styles.statusText, { color: theme.colors.text }]}>
              {isUpload ? '上传失败' : '同步失败'}
            </Text>
            {errorMessage && (
              <Text style={[styles.errorDetailText, { color: theme.colors.textTertiary }]}>
                {errorMessage}
              </Text>
            )}
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    gap: 16,
  },
  statusText: {
    fontSize: 16,
  },
  successIcon: {
    fontSize: 48,
  },
  errorIcon: {
    fontSize: 48,
  },
  errorDetailText: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 280,
  },
});
