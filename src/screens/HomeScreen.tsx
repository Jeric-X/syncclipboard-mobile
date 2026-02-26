/**
 * Home Screen
 * 首页 - 显示当前剪贴板和同步状态
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Animated,
  AppState,
  AppStateStatus,
  TouchableOpacity,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@/hooks/useTheme';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useSyncStore } from '@/stores/syncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { SyncDirection } from '@/types/sync';
import { ClipboardContent } from '@/types/clipboard';
import { CurrentClipboardCard } from '@/components/CurrentClipboardCard';
import { createAPIClient, getSignalRClient } from '@/services';
import type { RemoteClipboardChangedCallback } from '@/services';
import { getFileExtension, getFileUri, initFileStorage } from '@/utils/fileStorage';

type MessageType = 'success' | 'error' | 'info';

export function HomeScreen() {
  const { theme } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [remoteContent, setRemoteContent] = useState<ClipboardContent | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [downloadingRemote, setDownloadingRemote] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: MessageType } | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [fadeAnim] = useState(new Animated.Value(0));
  const appState = useRef(AppState.currentState);
  const remotePollingInterval = useRef<NodeJS.Timeout | null>(null);
  const lastRemoteProfileHash = useRef<string | null>(null);
  const lastLocalProfileHash = useRef<string | null>(null);
  const isAutoSyncing = useRef(false);
  const signalRClient = useRef(getSignalRClient());
  const signalRConnected = useRef(false);

  const { currentContent, getContent, startMonitoring, stopMonitoring } = useClipboardStore();
  const { stats, sync, initialize: initializeSync, destroy: destroySync } = useSyncStore();
  const { getActiveServer, loadConfig, isLoaded, config } = useSettingsStore();

  const activeServer = getActiveServer();
  const lastSyncTime = stats?.lastSyncTime || null;

  // 远程剪贴板轮询间隔（毫秒）
  const REMOTE_POLLING_INTERVAL = 3000; // 3秒

  // 下载远程文件的公共逻辑
  const downloadRemoteFileInternal = async (
    content: ClipboardContent,
    apiClient: ReturnType<typeof createAPIClient>
  ): Promise<ClipboardContent> => {
    // 检查是否需要下载文件
    const needsDownload =
      (content.type === 'Image' && content.fileName && !content.imageUri) ||
      (content.type === 'File' && content.fileName && !content.fileUri);

    if (!needsDownload || !content.fileName || !content.profileHash) {
      return content;
    }

    // 初始化文件存储
    await initFileStorage();

    // 提取文件扩展名
    const extension = getFileExtension(content.fileName);

    // 检查文件是否已存在
    let fileUri: string | null = null;
    if (content.type === 'Image' || content.type === 'File') {
      fileUri = await getFileUri(content.type, content.profileHash, extension);
    }

    // 如果文件不存在，直接下载到文件系统
    if (!fileUri && (content.type === 'Image' || content.type === 'File')) {
      const { Paths, Directory, File } = await import('expo-file-system');
      const baseDir = new Directory(Paths.document, 'clipboards');
      const dir =
        content.type === 'Image'
          ? new Directory(baseDir, 'images')
          : new Directory(baseDir, 'files');
      const fileName = extension ? `${content.profileHash}${extension}` : content.profileHash;
      const destinationFile = new File(dir, fileName);

      fileUri = await apiClient.downloadFile(content.fileName, destinationFile.uri);
    }

    // 返回更新后的内容
    const updatedContent: ClipboardContent = {
      ...content,
    };

    if (content.type === 'Image' && fileUri) {
      updatedContent.imageUri = fileUri;
    } else if (content.type === 'File' && fileUri) {
      updatedContent.fileUri = fileUri;
    }

    return updatedContent;
  };

  // 显示消息提示
  const showMessage = (text: string, type: MessageType = 'info') => {
    setMessage({ text, type });

    // 淡入动画
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.delay(2500),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setMessage(null);
    });
  };

  // 处理远程剪贴板内容更新的公共逻辑
  const processRemoteClipboardContent = async (
    content: ClipboardContent,
    currentHash: string,
    hasData: boolean,
    apiClient: ReturnType<typeof createAPIClient>,
    logPrefix: string = ''
  ) => {
    const previousHash = lastRemoteProfileHash.current;

    // 检查是否有变化
    if (previousHash === currentHash) {
      return; // 没有变化，不处理
    }

    lastRemoteProfileHash.current = currentHash;

    // 1. 先处理自动下载
    const autoDownloadMaxSize = config?.autoDownloadMaxSize ?? 5 * 1024 * 1024;
    const hasFileData =
      content.type !== 'Text' &&
      content.fileName &&
      content.fileSize !== undefined &&
      !content.imageUri &&
      !content.fileUri;

    console.log(`[HomeScreen] ${logPrefix}hasFileData判断变量:`, {
      'content.type': content.type,
      'content.fileName': content.fileName,
      'content.fileSize': content.fileSize,
      'content.imageUri': content.imageUri,
      'content.fileUri': content.fileUri,
      hasFileData,
    });

    // 标记是否因为文件过大而跳过自动复制
    let skipAutoCopyDueToLargeFile = false;
    let finalContent = content; // 最终要显示的内容

    if (hasFileData) {
      const fileTooLarge = content.fileSize! > autoDownloadMaxSize;

      console.log(`[HomeScreen] ${logPrefix}Auto-download check:`, {
        type: content.type,
        fileName: content.fileName,
        fileSize: content.fileSize,
        autoDownloadMaxSize,
        hasData: hasData,
        fileTooLarge,
        hasImageUri: !!content.imageUri,
        hasFileUri: !!content.fileUri,
      });

      if (fileTooLarge) {
        // 文件过大，跳过自动下载，同时标记需要跳过自动复制
        if (hasData) {
          skipAutoCopyDueToLargeFile = true;
          console.log(
            `[HomeScreen] ${logPrefix}File too large (${content.fileSize} bytes > ${autoDownloadMaxSize} bytes), skipping auto-download and auto-copy`
          );
        }
      } else {
        // 文件大小在限制内，执行自动下载
        console.log(
          `[HomeScreen] ${logPrefix}Auto-downloading file (${content.fileSize} bytes, limit: ${autoDownloadMaxSize} bytes)`
        );
        try {
          finalContent = await downloadRemoteFileInternal(content, apiClient);
          console.log(
            `[HomeScreen] ${logPrefix}Auto-download completed:`,
            finalContent.imageUri || finalContent.fileUri
          );
        } catch (downloadError) {
          console.error(`[HomeScreen] ${logPrefix}Auto-download failed:`, downloadError);
          // 下载失败也跳过自动复制
          if (hasData) {
            skipAutoCopyDueToLargeFile = true;
          }
        }
      }
    }

    // 更新界面显示（只调用一次，确保界面正确更新）
    setRemoteContent(finalContent);

    // 2. 处理自动复制
    // 只要检测到远程变化（不是首次加载），且启用了自动复制，就自动复制到本地剪贴板
    const isFirstLoad = previousHash === null;

    if (!isFirstLoad) {
      console.log(`[HomeScreen] ${logPrefix}Remote clipboard changed, updated display`);

      // 如果启用了自动同步，自动复制远程内容到本地剪贴板
      const autoSyncEnabled = config?.autoSync ?? false;
      if (
        autoSyncEnabled &&
        activeServer &&
        !isAutoSyncing.current &&
        !skipAutoCopyDueToLargeFile
      ) {
        console.log(`[HomeScreen] ${logPrefix}Auto-copying remote changes to local clipboard`);
        isAutoSyncing.current = true;
        try {
          const { setContent } = useClipboardStore.getState();
          await setContent(finalContent);
          // 更新本地哈希，避免触发自动上传
          lastLocalProfileHash.current = currentHash;
          console.log(`[HomeScreen] ${logPrefix}Auto-copy to local clipboard completed`);
        } catch (error) {
          console.error(`[HomeScreen] ${logPrefix}Auto-copy to local clipboard failed:`, error);
        } finally {
          isAutoSyncing.current = false;
        }
      } else if (skipAutoCopyDueToLargeFile) {
        console.log(
          `[HomeScreen] ${logPrefix}Skipped auto-copy due to large file without auto-download`
        );
      }
    }
  };

  // 获取远程剪贴板内容
  const fetchRemoteClipboard = async (silent: boolean = false) => {
    if (!activeServer) {
      setRemoteContent(null);
      lastRemoteProfileHash.current = null;
      return;
    }

    if (!silent) {
      setLoadingRemote(true);
    }

    try {
      const apiClient = createAPIClient(activeServer);
      const profile = await apiClient.getClipboard();

      if (profile) {
        // 转换为 ClipboardContent
        const { profileDtoToContent } = await import('@/utils/clipboard');
        const content = profileDtoToContent(profile);
        const currentHash = content.profileHash || content.text || '';

        // 使用公共处理函数
        await processRemoteClipboardContent(
          content,
          currentHash,
          profile.hasData,
          apiClient,
          silent ? '' : 'Polling: ' // 日志前缀
        );
      } else {
        setRemoteContent(null);
        lastRemoteProfileHash.current = null;
      }
    } catch (error) {
      console.error('[HomeScreen] Failed to fetch remote clipboard:', error);
      if (!silent) {
        setRemoteContent(null);
        lastRemoteProfileHash.current = null;
        // 显示连接错误
        const errorMessage = error instanceof Error ? error.message : '无法连接到服务器';
        setError({
          title: '连接失败',
          message: errorMessage,
        });
      }
    } finally {
      if (!silent) {
        setLoadingRemote(false);
      }
    }
  };

  // 启动远程剪贴板轮询
  const startRemotePolling = () => {
    if (!activeServer || remotePollingInterval.current) {
      if (remotePollingInterval.current) {
        console.log('[HomeScreen] Polling already active, skipping');
      }
      return;
    }

    console.log(
      '[HomeScreen] Starting remote clipboard polling for server type:',
      activeServer.type
    );

    // 立即获取一次
    fetchRemoteClipboard(true);

    // 设置定时轮询
    remotePollingInterval.current = setInterval(() => {
      fetchRemoteClipboard(true);
    }, REMOTE_POLLING_INTERVAL);
  };

  // 停止远程剪贴板轮询
  const stopRemotePolling = () => {
    if (remotePollingInterval.current) {
      console.log('[HomeScreen] Stopping remote clipboard polling');
      clearInterval(remotePollingInterval.current);
      remotePollingInterval.current = null;
    }
  };

  // 连接 SignalR
  const connectSignalR = async () => {
    if (!activeServer || activeServer.type !== 'syncclipboard') {
      console.log('[HomeScreen] Cannot connect SignalR - server type:', activeServer?.type);
      return;
    }

    try {
      console.log('[HomeScreen] Connecting to SignalR for server:', activeServer.url);

      // 注册远程剪贴板变化回调
      const callback: RemoteClipboardChangedCallback = async (profile) => {
        console.log('[HomeScreen] SignalR: Remote clipboard changed');

        // 转换为 ClipboardContent
        const { profileDtoToContent } = await import('@/utils/clipboard');
        const content = profileDtoToContent(profile);
        const currentHash = content.profileHash || content.text || '';

        // 使用公共处理函数
        const apiClient = createAPIClient(activeServer);
        await processRemoteClipboardContent(
          content,
          currentHash,
          profile.hasData,
          apiClient,
          'SignalR: ' // 日志前缀
        );
      };

      signalRClient.current.onRemoteClipboardChanged(callback);

      // 开始连接
      await signalRClient.current.connect(activeServer);
      signalRConnected.current = true;

      // 连接成功后立即获取一次远程剪贴板
      await fetchRemoteClipboard(true);
    } catch (error) {
      console.error('[HomeScreen] Failed to connect SignalR:', error);
      signalRConnected.current = false;
    }
  };

  // 断开 SignalR
  const disconnectSignalR = async () => {
    if (signalRConnected.current) {
      console.log('[HomeScreen] Disconnecting SignalR...');
      signalRClient.current.clearCallbacks();
      await signalRClient.current.disconnect();
      signalRConnected.current = false;
    }
  };

  // 页面加载时加载配置、启动剪贴板监听
  useEffect(() => {
    const initialize = async () => {
      if (!isLoaded) {
        await loadConfig();
      }
      await getContent();

      // 启动剪贴板持续监听
      startMonitoring();
    };
    initialize();

    // 组件卸载时停止监听
    return () => {
      stopMonitoring();
    };
  }, [isLoaded, loadConfig, getContent, startMonitoring, stopMonitoring]);

  // 监听本地剪贴板变化，自动上传
  useEffect(() => {
    const autoSyncEnabled = config?.autoSync ?? false;
    if (!activeServer || !autoSyncEnabled || !currentContent) {
      return;
    }

    const currentHash = currentContent.profileHash || currentContent.text || '';

    // 初始化时记录当前哈希，不触发同步
    if (lastLocalProfileHash.current === null) {
      lastLocalProfileHash.current = currentHash;
      return;
    }

    // 检查是否有变化
    if (currentHash !== lastLocalProfileHash.current) {
      console.log('[HomeScreen] Local clipboard changed, auto-syncing to remote');
      lastLocalProfileHash.current = currentHash;

      // 自动上传到远程
      if (!isAutoSyncing.current) {
        isAutoSyncing.current = true;
        sync(SyncDirection.Upload)
          .then(() => {
            console.log('[HomeScreen] Auto-sync upload completed');
            // 刷新远程显示
            fetchRemoteClipboard(true);
          })
          .catch((error) => {
            console.error('[HomeScreen] Auto-sync upload failed:', error);
          })
          .finally(() => {
            isAutoSyncing.current = false;
          });
      }
    }
  }, [currentContent, activeServer, config, sync]);

  // 当服务器配置改变时，启动/停止远程轮询或 SignalR
  useEffect(() => {
    const initializeRemoteSync = async () => {
      console.log('[HomeScreen] Initializing remote sync for server type:', activeServer?.type);

      // 先停止现有的连接
      stopRemotePolling();
      await disconnectSignalR();
      lastRemoteProfileHash.current = null;

      if (activeServer) {
        // 销毁旧的 SyncManager 实例，然后重新初始化（这样才能使用新的服务器配置）
        console.log(
          '[HomeScreen] Destroying old SyncManager and reinitializing with new server:',
          activeServer.url
        );
        await destroySync();
        await initializeSync();

        // 立即获取一次（显示 loading）
        await fetchRemoteClipboard(false);

        // 根据服务器类型选择 SignalR 或轮询
        console.log(
          '[HomeScreen] Server type is:',
          activeServer.type,
          '| Will use:',
          activeServer.type === 'syncclipboard' ? 'SignalR' : 'Polling'
        );

        if (activeServer.type === 'syncclipboard') {
          // 使用 SignalR 实时通信
          await connectSignalR();
        } else {
          // 使用轮询模式
          startRemotePolling();
        }
      } else {
        console.log('[HomeScreen] No active server configured');
        setRemoteContent(null);
        // 也销毁 SyncManager 当没有服务器时
        await destroySync();
      }
    };

    initializeRemoteSync();

    return () => {
      stopRemotePolling();
      disconnectSignalR();
    };
  }, [activeServer, config, initializeSync, destroySync]);

  // 监听应用状态变化，控制远程剪贴板轮询或 SignalR
  // 本地剪贴板已由 ClipboardMonitor 持续监听，无需在此处处理
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      async (nextAppState: AppStateStatus) => {
        // 当从后台切换到前台时
        if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
          console.log('[HomeScreen] App has come to the foreground');

          // 重新获取本地剪贴板内容，检查在后台期间是否有变化
          console.log('[HomeScreen] Checking local clipboard for changes while in background');
          await getContent();

          // 如果有配置服务器
          if (activeServer) {
            if (activeServer.type === 'syncclipboard') {
              // SignalR 会自动重连，但我们手动刷新一次
              if (signalRClient.current.isConnected()) {
                await fetchRemoteClipboard(true);
              } else {
                await connectSignalR();
              }
            } else {
              // 轮询模式：启动轮询
              startRemotePolling();
            }
          }
        } else if (nextAppState === 'background' || nextAppState === 'inactive') {
          console.log('[HomeScreen] App has gone to the background');

          // 应用进入后台，停止轮询（SignalR 保持连接）
          stopRemotePolling();
        }

        appState.current = nextAppState;
      }
    );

    return () => {
      subscription.remove();
    };
  }, [activeServer, getContent]);

  // 下拉刷新
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await getContent();
      if (activeServer) {
        // 只刷新远程剪贴板显示，不自动下载复制
        // 用户可以通过点击"下载"按钮手动复制到剪贴板
        await fetchRemoteClipboard(false);
      }
    } catch (error) {
      console.error('[HomeScreen] Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // 快速操作
  const handleUpload = async () => {
    if (!activeServer) {
      showMessage('请先在设置中配置服务器', 'info');
      return;
    }

    try {
      setError(null); // 清除之前的错误
      console.log('[HomeScreen] Starting upload...');
      const result = await sync(SyncDirection.Upload);
      console.log('[HomeScreen] Upload result:', JSON.stringify(result, null, 2));

      // 检查同步结果
      if (result.success) {
        await fetchRemoteClipboard(false); // 刷新远程剪贴板显示
        showMessage('剪贴板已上传到服务器', 'success');
      } else {
        // 上传失败，显示错误信息
        const errorMessage = result.error || '上传失败';
        console.log('[HomeScreen] Upload failed, setting error:', errorMessage);
        setError({
          title: '上传失败',
          message: errorMessage,
        });
        showMessage('上传失败', 'error');
      }
    } catch (error: unknown) {
      // 处理意外异常（通常不会到这里）
      console.error('[HomeScreen] Upload exception:', error);
      const errorMessage = error instanceof Error ? error.message : '无法上传到服务器';
      const errorObj = error instanceof Error ? (error as unknown as Record<string, unknown>) : {};
      const errorDetails =
        error instanceof Error && errorObj.response
          ? JSON.stringify((errorObj.response as Record<string, unknown>).data, null, 2)
          : errorMessage;
      console.log('[HomeScreen] Setting error details:', errorDetails);
      setError({
        title: '上传失败',
        message: errorDetails,
      });
      showMessage('上传失败', 'error');
    }
  };

  const handleCopyError = async () => {
    if (error) {
      await Clipboard.setStringAsync(`${error.title}\n\n${error.message}`);
      showMessage('错误信息已复制', 'success');
    }
  };

  // 下载远程剪贴板的文件数据
  const handleDownloadRemoteFile = async () => {
    if (!activeServer || !remoteContent) {
      return;
    }

    // 检查是否需要下载文件
    const needsDownload =
      (remoteContent.type === 'Image' && remoteContent.fileName && !remoteContent.imageUri) ||
      (remoteContent.type === 'File' && remoteContent.fileName && !remoteContent.fileUri);

    if (!needsDownload) {
      return;
    }

    setDownloadingRemote(true);
    try {
      const apiClient = createAPIClient(activeServer);
      const updatedContent = await downloadRemoteFileInternal(remoteContent, apiClient);
      setRemoteContent(updatedContent);
      showMessage('文件已下载', 'success');
    } catch (error) {
      console.error('[HomeScreen] Failed to download remote file:', error);
      showMessage('文件下载失败', 'error');
    } finally {
      setDownloadingRemote(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
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
                远程剪贴板
              </Text>
              {loadingRemote ? (
                <View style={[styles.loadingCard, { backgroundColor: theme.colors.surface }]}>
                  <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                    加载中...
                  </Text>
                </View>
              ) : (
                <CurrentClipboardCard
                  clipboard={remoteContent}
                  isRemote={true}
                  onDownload={handleDownloadRemoteFile}
                  downloading={downloadingRemote}
                />
              )}
            </View>

            {/* 本地剪贴板 */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                本地剪贴板
              </Text>
              <CurrentClipboardCard
                clipboard={currentContent}
                isRemote={false}
                onUpload={handleUpload}
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
                      <Text style={styles.copyButtonText}>复制错误</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.errorScrollView} nestedScrollEnabled={true}>
                    <Text style={[styles.errorText, { color: theme.colors.errorText }]}>
                      {error.message}
                    </Text>
                  </ScrollView>
                  <TouchableOpacity style={styles.dismissButton} onPress={() => setError(null)}>
                    <Text style={[styles.dismissButtonText, { color: theme.colors.errorTitle }]}>
                      关闭
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </>
        ) : (
          <>
            {/* 未配置服务器时只显示本地剪贴板 */}
            <CurrentClipboardCard clipboard={currentContent} isRemote={false} />
          </>
        )}

        {/* 空状态提示 */}
        {!activeServer && (
          <View style={[styles.emptyState, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>未配置服务器</Text>
            <Text style={[styles.emptyStateText, { color: theme.colors.textSecondary }]}>
              请在"设置"页面添加服务器配置以启用同步功能
            </Text>
          </View>
        )}

        {/* 最近同步信息 */}
        {activeServer && lastSyncTime && (
          <View style={[styles.infoCard, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>
              当前服务器
            </Text>
            <Text style={[styles.infoValue, { color: theme.colors.text }]}>{activeServer.url}</Text>
            <Text
              style={[
                styles.infoLabel,
                styles.infoLabelSpaced,
                { color: theme.colors.textSecondary },
              ]}
            >
              最近同步
            </Text>
            <Text style={[styles.infoValue, { color: theme.colors.text }]}>
              {new Date(lastSyncTime).toLocaleString('zh-CN')}
            </Text>
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* 消息提示 */}
      {message && (
        <Animated.View
          style={[
            styles.messageContainer,
            message.type === 'success' && { backgroundColor: theme.colors.messageSuccess },
            message.type === 'error' && { backgroundColor: theme.colors.messageError },
            message.type === 'info' && { backgroundColor: theme.colors.primary },
            { opacity: fadeAnim },
          ]}
        >
          <Text style={[styles.messageText, { color: theme.colors.white }]}>{message.text}</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  messageContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  messageText: {
    fontSize: 15,
    fontWeight: '500',
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
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
  // eslint-disable-next-line react-native/no-color-literals
  copyButtonText: {
    color: '#FFF',
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
