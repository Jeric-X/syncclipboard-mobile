/**
 * Home Screen
 * 首页 - 显示当前剪贴板和同步状态
 */

import React, { useState, useLayoutEffect, useMemo, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import * as ClipboardProxy from '@/utils/clipboardProxy';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '@/hooks/useTheme';
import { useLocalClipboardStore } from '@/stores/localClipboardStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useClipboardSyncServiceStore } from '@/serviceState/ClipboardSyncState';
import { ClipboardContent } from '@/types/clipboard';
import { CurrentClipboardCard } from '@/components/CurrentClipboardCard';
import { MessageToast } from '@/components/MessageToast';
import { TopRightMenu, type MenuItemConfig } from '@/components/TopRightMenu';
import { WordPickerScreen } from '@/screens/WordPickerScreen';
import { useMessageStore } from '@/stores/messageStore';
import { useErrorStore } from '@/stores/errorStore';
import { QuickLoadingPage } from '@/components/QuickLoadingPage';
import { createContentFromFile } from '@/utils/clipboard/clipboardContentUtils';
import {
  setRemoteClipboard,
  uploadLocalClipboard,
  cancelUploadLocalClipboard,
  downloadRemoteClipboard,
  cancelRemoteClipboardDownload,
  refreshMonitor,
} from '@/services/sync/ClipboardSyncActions';
import type { ProgressInfo } from '@/types/progress';
import { longRunningTaskManager } from '@/longRunningTask/LongRunningTaskManager';

export function HomeScreen() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [refreshing, setRefreshing] = useState(false);
  const [fileUploadPayload, setFileUploadPayload] = useState<{
    uri: string;
    fileName: string;
    mimeType?: string | null;
    fileSize?: number;
  } | null>(null);
  const [wordPickerText, setWordPickerText] = useState<string | null>(null);
  const { error, setError, clearError } = useErrorStore();
  const { message, showMessage, clearMessage } = useMessageStore();

  // 远程剪贴板状态由 ClipboardSyncService 维护，从 store 读取
  const remoteContent = useClipboardSyncServiceStore((s) => s.remoteContent);
  const loadingRemote = useClipboardSyncServiceStore((s) => s.loadingRemote);
  const downloadingRemote = useClipboardSyncServiceStore((s) => s.downloadingRemote);
  const downloadProgress = useClipboardSyncServiceStore((s) => s.downloadProgress);
  const uploadingClipboard = useClipboardSyncServiceStore((s) => s.uploadingClipboard);
  const uploadProgress = useClipboardSyncServiceStore((s) => s.uploadProgress);
  const [fileUploadProgress, setFileUploadProgress] = useState<ProgressInfo | null>(null);
  const syncError = useClipboardSyncServiceStore((s) => s.syncError);

  const { currentContent } = useLocalClipboardStore();
  const { getActiveServer } = useSettingsStore();

  // 启动所有后台任务（先加载字体，再启动后台任务，避免后台繁重任务导致导航栏图标加载缓慢）
  useEffect(() => {
    Ionicons.loadFont().then(() => {
      longRunningTaskManager.startAll().catch(() => {});
    });
  }, []);

  const activeServer = getActiveServer();

  // 复制远程内容到本地剪贴板
  const copyRemoteToLocal = async (content: ClipboardContent, logPrefix: string = '') => {
    const { localClipboard } = await import('@/services');
    await localClipboard.setClipboardContent(content, true);
    console.log(`[HomeScreen] ${logPrefix}Copy to local clipboard completed`);
  };

  // 复制本地剪贴板内容（简单模式，直接设置到剪贴板）
  const copyLocalToClipboard = async (content: ClipboardContent) => {
    try {
      const { localClipboard } = await import('@/services');
      await localClipboard.setClipboardContent(content);
      showMessage(t('clipboard.copied'), 'success');
    } catch (error) {
      console.error('[HomeScreen] Failed to copy local content:', error);
      showMessage(t('clipboard.copyFailed'), 'error');
    }
  };

  // 处理上传文件
  const handleUploadFile = useCallback(async () => {
    try {
      clearError();

      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset) {
        showMessage(t('home.noFileSelected'), 'error');
        return;
      }

      setFileUploadPayload({
        uri: asset.uri,
        fileName: asset.name || 'file',
        mimeType: asset.mimeType,
        fileSize: asset.size,
      });
    } catch (error) {
      console.error('[HomeScreen] Failed to pick file:', error);
      showMessage(t('home.pickFileFailed'), 'error');
    }
  }, [showMessage]);

  // 处理上传图片
  const handleUploadImage = useCallback(async () => {
    try {
      clearError();

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset) {
        showMessage(t('home.noImageSelected'), 'error');
        return;
      }

      setFileUploadPayload({
        uri: asset.uri,
        fileName: asset.fileName || `image_${Date.now()}.jpg`,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
      });
    } catch (error) {
      console.error('[HomeScreen] Failed to pick image:', error);
      showMessage(t('home.pickImageFailed'), 'error');
    }
  }, [showMessage]);

  const fileUploadTask = useCallback(
    async (signal: AbortSignal) => {
      if (!fileUploadPayload) throw new Error(t('home.noFileToUpload'));

      const content = await createContentFromFile(
        fileUploadPayload.uri,
        fileUploadPayload.fileName,
        fileUploadPayload.mimeType,
        fileUploadPayload.fileSize,
        { signal }
      );
      await setRemoteClipboard(content, signal, (info) => {
        setFileUploadProgress(info);
      });
    },
    [fileUploadPayload, t]
  );

  const handleFileUploadComplete = useCallback(() => {
    setFileUploadPayload(null);
    setFileUploadProgress(null);
  }, []);

  // 菜单项配置
  const menuItems = useMemo<MenuItemConfig[]>(
    () => [
      {
        label: t('home.uploadImage'),
        onPress: handleUploadImage,
        disabled: !!fileUploadPayload,
      },
      {
        label: t('home.uploadFile'),
        onPress: handleUploadFile,
        disabled: !!fileUploadPayload,
      },
    ],
    [handleUploadImage, handleUploadFile, fileUploadPayload]
  );

  // 设置标题栏菜单按钮
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <TopRightMenu items={menuItems} />,
    });
  }, [navigation, menuItems]);

  // 下拉刷新：刷新本地 + 远程剪贴板内容，错误由 service 写入 errorStore
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshMonitor();
    } finally {
      setRefreshing(false);
    }
  };

  // 快速操作
  const handleUpload = async () => {
    try {
      clearError();

      console.log('[HomeScreen] Starting upload...');
      await uploadLocalClipboard();
    } catch (error: unknown) {
      console.error('[HomeScreen] Upload exception:', error);
      const errorMessage = error instanceof Error ? error.message : t('home.cantUploadToServer');
      const normalizedMessage = errorMessage.toLowerCase();
      const isCanceled =
        (error instanceof Error && error.name === 'AbortError') ||
        normalizedMessage.includes('abort') ||
        normalizedMessage.includes('canceled') ||
        normalizedMessage.includes('cancelled');

      if (isCanceled) {
        return;
      }

      const errorObj = error instanceof Error ? (error as unknown as Record<string, unknown>) : {};
      const errorDetails =
        error instanceof Error && errorObj.response
          ? JSON.stringify((errorObj.response as Record<string, unknown>).data, null, 2)
          : errorMessage;
      console.log('[HomeScreen] Setting error details:', errorDetails);
      setError({
        title: t('home.uploadFailed'),
        message: errorDetails,
      });
      showMessage(t('home.uploadFailed'), 'error');
    }
  };

  // 取消剪贴板上传
  const handleCancelClipboardUpload = useCallback(() => {
    if (!uploadingClipboard) {
      return;
    }

    cancelUploadLocalClipboard();
    showMessage(t('home.cancelingUpload'), 'info');
  }, [uploadingClipboard, showMessage]);

  const handleCopyError = async () => {
    if (error) {
      await ClipboardProxy.setStringAsync(`${error.title}\n\n${error.message}`);
      showMessage(t('home.errorCopied'), 'success');
    }
  };

  // 检查是否需要下载文件
  const needsDownload = useMemo(() => {
    if (!remoteContent) return false;
    return !!(remoteContent.hasData && remoteContent.fileName && !remoteContent.fileUri);
  }, [remoteContent]);

  // 下载远程剪贴板的文件数据
  const handleDownloadRemoteFile = async () => {
    if (!remoteContent || !needsDownload) return;
    try {
      await downloadRemoteClipboard();
    } catch (error) {
      console.error('[HomeScreen] Failed to download remote file:', error);
      showMessage(t('home.fileDownloadFailed'), 'error');
    }
  };

  // 取消下载
  const handleCancelDownload = useCallback(() => {
    cancelRemoteClipboardDownload();
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {syncError && (
        <View style={[styles.syncErrorBanner, { backgroundColor: theme.colors.errorBackground }]}>
          <View style={styles.syncErrorContent}>
            <Text style={[styles.syncErrorTitle, { color: theme.colors.errorTitle }]}>
              {syncError.title}
            </Text>
          </View>
        </View>
      )}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* 当有服务器配置时显示远程和本地剪贴板 */}
        {activeServer ? (
          <>
            {/* 远程剪贴板 */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                {t('home.remoteClipboard')}
              </Text>
              {loadingRemote ? (
                <View style={[styles.loadingCard, { backgroundColor: theme.colors.surface }]}>
                  <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                    {t('common.loading')}
                  </Text>
                </View>
              ) : (
                <CurrentClipboardCard
                  clipboard={remoteContent}
                  isRemote={true}
                  onAction={handleDownloadRemoteFile}
                  acting={downloadingRemote}
                  actionProgress={downloadProgress}
                  onCancelAction={handleCancelDownload}
                  onCopy={async (content) => {
                    try {
                      await copyRemoteToLocal(content, 'Manual copy: ');
                      showMessage(
                        content.type === 'Image'
                          ? t('clipboard.imageCopied')
                          : t('clipboard.copied'),
                        'success'
                      );
                    } catch (error) {
                      showMessage(
                        error instanceof Error
                          ? error.message || t('clipboard.copyFailed')
                          : t('clipboard.copyFailed'),
                        'error'
                      );
                    }
                  }}
                  onWordPick={setWordPickerText}
                />
              )}
            </View>

            {/* 本地剪贴板 */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                {t('home.localClipboard')}
              </Text>
              <CurrentClipboardCard
                clipboard={currentContent}
                isRemote={false}
                onAction={handleUpload}
                acting={uploadingClipboard}
                actionProgress={uploadProgress}
                onCancelAction={handleCancelClipboardUpload}
                onCopy={copyLocalToClipboard}
                onWordPick={setWordPickerText}
              />

              {/* 错误信息卡片 */}
              {error && (
                <View
                  style={[
                    styles.errorCard,
                    {
                      backgroundColor: theme.colors.errorBackground,
                      borderColor: theme.colors.errorBorder,
                    },
                  ]}
                >
                  <View style={styles.errorHeader}>
                    <Text style={[styles.errorTitle, { color: theme.colors.errorTitle }]}>
                      {error.title}
                    </Text>
                    <TouchableOpacity
                      style={[styles.copyButton, { backgroundColor: theme.colors.errorTitle }]}
                      onPress={handleCopyError}
                    >
                      <Text style={[styles.copyButtonText, { color: theme.colors.white }]}>
                        {t('home.copyError')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.errorScrollView} nestedScrollEnabled={true}>
                    <Text style={[styles.errorText, { color: theme.colors.errorText }]}>
                      {error.message}
                    </Text>
                  </ScrollView>
                  <TouchableOpacity style={styles.dismissButton} onPress={() => clearError()}>
                    <Text style={[styles.dismissButtonText, { color: theme.colors.errorTitle }]}>
                      {t('common.close')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </>
        ) : (
          <>
            {/* 未配置服务器时只显示本地剪贴板 */}
            <CurrentClipboardCard
              clipboard={currentContent}
              isRemote={false}
              onCopy={copyLocalToClipboard}
              onWordPick={setWordPickerText}
            />
          </>
        )}

        {/* 空状态提示 */}
        {!activeServer && (
          <View style={[styles.emptyState, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>
              {t('home.noServerTitle')}
            </Text>
            <Text style={[styles.emptyStateText, { color: theme.colors.textSecondary }]}>
              {t('home.noServerDescription')}
            </Text>
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* 消息提示 */}
      <MessageToast message={message} onMessageShown={clearMessage} />

      {fileUploadPayload && (
        <View style={styles.fullScreenOverlay}>
          <QuickLoadingPage
            task={fileUploadTask}
            loadingText={t('home.uploadingFile')}
            successText={t('home.uploadSuccess')}
            failureText={t('home.uploadFailed')}
            onComplete={handleFileUploadComplete}
            progress={fileUploadProgress}
            previewText={fileUploadPayload.fileName}
            previewImage={
              fileUploadPayload.mimeType?.startsWith('image/') ? fileUploadPayload.uri : undefined
            }
          />
        </View>
      )}

      {wordPickerText && (
        <View style={styles.fullScreenOverlay}>
          <WordPickerScreen text={wordPickerText} onComplete={() => setWordPickerText(null)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fullScreenOverlay: {
    ...StyleSheet.absoluteFill,
  },
  syncErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  syncErrorContent: {
    flex: 1,
  },
  syncErrorTitle: {
    fontSize: 14,
    fontWeight: '600',
  },

  infoLabelSpaced: {
    marginTop: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  loadingCard: {
    borderRadius: 12,
    padding: 16,
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 15,
  },
  emptyState: {
    marginTop: 16,
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  infoCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 15,
    marginTop: 4,
  },
  bottomPadding: {
    height: 100,
  },
  errorCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  errorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  copyButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  copyButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  errorScrollView: {
    maxHeight: 200,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  dismissButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  dismissButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
