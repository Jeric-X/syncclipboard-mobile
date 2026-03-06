import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  ToastAndroid,
  TouchableOpacity,
  BackHandler,
} from 'react-native';
import { SyncDirection } from '@/types/sync';
import { ClipboardContent } from '@/types/clipboard';
import { SyncManager } from '@/services/SyncManager';
import { useSyncStore } from '@/stores/syncStore';
import { useTheme } from '@/hooks/useTheme';
import { openFile, shareFile } from '@/utils/fileActions';

interface QuickTileLoadingScreenProps {
  direction: SyncDirection;
  onLoadingComplete: () => void;
}

type SyncState = 'loading' | 'success' | 'success-file' | 'error';

export const QuickTileLoadingScreen: React.FC<QuickTileLoadingScreenProps> = ({
  direction,
  onLoadingComplete,
}) => {
  const { theme } = useTheme();
  const [syncState, setSyncState] = useState<SyncState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [downloadedContent, setDownloadedContent] = useState<ClipboardContent | null>(null);

  const isUpload = direction === SyncDirection.Upload;

  const runSync = useCallback(async () => {
    setSyncState('loading');
    setErrorMessage(null);
    setDownloadedContent(null);
    try {
      // 确保 SyncManager 已初始化（冷启动时尚未经过正常启动流程）
      await useSyncStore.getState().initialize();
      const initError = useSyncStore.getState().error;
      if (initError) {
        throw new Error(initError);
      }

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

        // 下载了非文本文件时，停留页面显示操作按钮
        if (!isUpload && content && content.type !== 'Text' && content.fileUri) {
          setDownloadedContent(content);
          setSyncState('success-file');
        } else {
          setSyncState('success');
          setTimeout(onLoadingComplete, 500);
        }
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
    }
  }, [direction, isUpload, onLoadingComplete]);

  useEffect(() => {
    runSync();
  }, [runSync]);

  // 系统返回键：在等待用户操作（error / success-file）时直接离开
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (syncState === 'error' || syncState === 'success-file') {
        onLoadingComplete();
        return true; // 拦截默认行为
      }
      return false; // 其他状态保持默认行为
    });
    return () => subscription.remove();
  }, [syncState, onLoadingComplete]);

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
        {syncState === 'success-file' && downloadedContent && (
          <>
            <Text style={[styles.successIcon, { color: theme.colors.success }]}>✓</Text>
            <Text style={[styles.statusText, { color: theme.colors.text }]}>下载成功</Text>
            {downloadedContent.fileName && (
              <Text style={[styles.fileNameText, { color: theme.colors.textSecondary }]}>
                {downloadedContent.fileName}
              </Text>
            )}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.colors.primary }]}
                onPress={async () => {
                  try {
                    await openFile(downloadedContent.fileUri!);
                  } catch {}
                }}
              >
                <Text style={[styles.buttonText, { color: theme.colors.white }]}>打开</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.colors.primary }]}
                onPress={async () => {
                  try {
                    await shareFile(downloadedContent.fileUri!, downloadedContent.fileName);
                  } catch {}
                }}
              >
                <Text style={[styles.buttonText, { color: theme.colors.white }]}>分享</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.button,
                  styles.buttonOutline,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
                onPress={onLoadingComplete}
              >
                <Text style={[styles.buttonText, { color: theme.colors.text }]}>返回</Text>
              </TouchableOpacity>
            </View>
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
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.colors.primary }]}
                onPress={runSync}
              >
                <Text style={[styles.buttonText, { color: theme.colors.white }]}>重试</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.button,
                  styles.buttonOutline,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.border,
                  },
                ]}
                onPress={onLoadingComplete}
              >
                <Text style={[styles.buttonText, { color: theme.colors.text }]}>返回</Text>
              </TouchableOpacity>
            </View>
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
  fileNameText: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 280,
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
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  buttonOutline: {
    borderWidth: 1,
  },
});
