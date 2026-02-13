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
  TouchableOpacity,
  Animated,
  AppState,
  AppStateStatus,
} from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useSyncStore } from '@/stores/syncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { SyncStatus, SyncDirection } from '@/types/sync';
import { ClipboardContent } from '@/types/clipboard';
import { CurrentClipboardCard } from '@/components/CurrentClipboardCard';
import { createAPIClient, getSignalRClient } from '@/services';
import type { RemoteClipboardChangedCallback } from '@/services';

type MessageType = 'success' | 'error' | 'info';

export function HomeScreen() {
  const { theme } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [remoteContent, setRemoteContent] = useState<ClipboardContent | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: MessageType } | null>(null);
  const [fadeAnim] = useState(new Animated.Value(0));
  const appState = useRef(AppState.currentState);
  const remotePollingInterval = useRef<NodeJS.Timeout | null>(null);
  const lastRemoteHash = useRef<string | null>(null);
  const lastLocalHash = useRef<string | null>(null);
  const isAutoSyncing = useRef(false);
  const signalRClient = useRef(getSignalRClient());
  const signalRConnected = useRef(false);

  const { currentContent, getContent, startMonitoring, stopMonitoring } = useClipboardStore();
  const { status, stats, sync, initialize: initializeSync } = useSyncStore();
  const { getActiveServer, loadConfig, isLoaded, config } = useSettingsStore();

  const activeServer = getActiveServer();
  const lastSyncTime = stats?.lastSyncTime || null;
  const autoSyncEnabled = config?.autoSync ?? false;

  // 远程剪贴板轮询间隔（毫秒）
  const REMOTE_POLLING_INTERVAL = 3000; // 3秒

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

  // 获取远程剪贴板内容
  const fetchRemoteClipboard = async (silent: boolean = false) => {
    if (!activeServer) {
      setRemoteContent(null);
      lastRemoteHash.current = null;
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

        // 检查是否有变化
        const currentHash = content.hash || content.text || '';
        const previousHash = lastRemoteHash.current;
        const hasChanged = previousHash !== currentHash;

        if (hasChanged) {
          setRemoteContent(content);
          lastRemoteHash.current = currentHash;

          // 如果是静默模式且之前已有记录（不是第一次初始化），说明是真正的远程变化
          const isRealRemoteChange = silent && previousHash !== null;

          if (isRealRemoteChange) {
            console.log('[HomeScreen] Remote clipboard changed, updated display');

            // 如果启用了自动同步，自动复制远程内容到本地剪贴板
            if (autoSyncEnabled && activeServer && !isAutoSyncing.current) {
              console.log('[HomeScreen] Auto-copying remote changes to local clipboard');
              isAutoSyncing.current = true;
              try {
                const { setContent } = useClipboardStore.getState();
                await setContent(content);
                // 更新本地哈希，避免触发自动上传
                lastLocalHash.current = currentHash;
                console.log('[HomeScreen] Auto-copy to local clipboard completed');
              } catch (error) {
                console.error('[HomeScreen] Auto-copy to local clipboard failed:', error);
              } finally {
                isAutoSyncing.current = false;
              }
            }
          }
        }
      } else {
        setRemoteContent(null);
        lastRemoteHash.current = null;
      }
    } catch (error) {
      console.error('[HomeScreen] Failed to fetch remote clipboard:', error);
      if (!silent) {
        setRemoteContent(null);
        lastRemoteHash.current = null;
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
        const currentHash = content.hash || content.text || '';

        setRemoteContent(content);
        lastRemoteHash.current = currentHash;

        // 如果启用了自动同步，自动复制远程内容到本地剪贴板
        if (autoSyncEnabled && !isAutoSyncing.current) {
          console.log('[HomeScreen] SignalR: Auto-copying remote changes to local clipboard');
          isAutoSyncing.current = true;
          try {
            const { setContent } = useClipboardStore.getState();
            await setContent(content);
            // 更新本地哈希，避免触发自动上传
            lastLocalHash.current = currentHash;
            console.log('[HomeScreen] SignalR: Auto-copy to local clipboard completed');
          } catch (error) {
            console.error('[HomeScreen] SignalR: Auto-copy to local clipboard failed:', error);
          } finally {
            isAutoSyncing.current = false;
          }
        }
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
    if (!activeServer || !autoSyncEnabled || !currentContent) {
      return;
    }

    const currentHash = currentContent.hash || currentContent.text || '';

    // 初始化时记录当前哈希，不触发同步
    if (lastLocalHash.current === null) {
      lastLocalHash.current = currentHash;
      return;
    }

    // 检查是否有变化
    if (currentHash !== lastLocalHash.current) {
      console.log('[HomeScreen] Local clipboard changed, auto-syncing to remote');
      lastLocalHash.current = currentHash;

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
  }, [currentContent, activeServer, autoSyncEnabled, sync]);

  // 当服务器配置改变时，启动/停止远程轮询或 SignalR
  useEffect(() => {
    const initializeRemoteSync = async () => {
      console.log('[HomeScreen] Initializing remote sync for server type:', activeServer?.type);

      // 先停止现有的连接
      stopRemotePolling();
      await disconnectSignalR();
      lastRemoteHash.current = null;

      if (activeServer) {
        // 初始化同步管理器（用于上传功能）
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
      }
    };

    initializeRemoteSync();

    return () => {
      stopRemotePolling();
      disconnectSignalR();
    };
  }, [activeServer, initializeSync]);

  // 监听应用状态变化，控制远程剪贴板轮询或 SignalR
  // 本地剪贴板已由 ClipboardMonitor 持续监听，无需在此处处理
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      async (nextAppState: AppStateStatus) => {
        // 当从后台切换到前台时
        if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
          console.log('[HomeScreen] App has come to the foreground');

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
  }, [activeServer]);

  // 下拉刷新
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await getContent();
      if (activeServer) {
        await Promise.all([fetchRemoteClipboard(false), sync(SyncDirection.Download)]);
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
      await sync(SyncDirection.Upload);
      await fetchRemoteClipboard(false); // 刷新远程剪贴板显示
      showMessage('剪贴板已上传到服务器', 'success');
    } catch (error: any) {
      showMessage(error.message || '无法上传到服务器', 'error');
    }
  };

  // 下载远程剪贴板的文件数据
  const handleDownloadRemoteFile = async () => {
    if (!activeServer || !remoteContent) {
      return;
    }

    // 检查是否需要下载文件
    const needsDownload =
      (remoteContent.type === 'Image' && remoteContent.fileName && !remoteContent.fileData) ||
      (remoteContent.type === 'File' && remoteContent.fileName && !remoteContent.fileData);

    if (!needsDownload) {
      return;
    }

    setLoadingRemote(true);
    try {
      const apiClient = createAPIClient(activeServer);

      // 下载文件数据
      if (remoteContent.fileName) {
        const fileData = await apiClient.getFile(remoteContent.fileName);

        // 更新远程内容，添加文件数据
        setRemoteContent({
          ...remoteContent,
          fileData: await fileData.arrayBuffer(),
        });

        showMessage('文件已下载', 'success');
      }
    } catch (error) {
      console.error('[HomeScreen] Failed to download remote file:', error);
      showMessage('文件下载失败', 'error');
    } finally {
      setLoadingRemote(false);
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
            <Text style={[styles.infoLabel, { color: theme.colors.textSecondary, marginTop: 8 }]}>
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
            {
              backgroundColor:
                message.type === 'success'
                  ? '#4CAF50'
                  : message.type === 'error'
                    ? '#F44336'
                    : theme.colors.primary,
              opacity: fadeAnim,
            },
          ]}
        >
          <Text style={styles.messageText}>{message.text}</Text>
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
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '500',
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
    padding: 32,
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
});
