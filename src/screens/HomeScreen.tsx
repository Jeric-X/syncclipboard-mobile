/**
 * Home Screen
 * 首页 - 显示当前剪贴板和同步状态
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useSyncStore } from '@/stores/syncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { SyncStatus, SyncDirection } from '@/types/sync';
import { ClipboardContent } from '@/types/clipboard';
import { CurrentClipboardCard } from '@/components/CurrentClipboardCard';
import { SyncStatusIndicator } from '@/components/SyncStatusIndicator';
import { QuickActionsBar } from '@/components/QuickActionsBar';
import { createAPIClient } from '@/services';

type MessageType = 'success' | 'error' | 'info';

export function HomeScreen() {
  const { theme } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [remoteContent, setRemoteContent] = useState<ClipboardContent | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: MessageType } | null>(null);
  const [fadeAnim] = useState(new Animated.Value(0));

  const { currentContent, getContent } = useClipboardStore();
  const { status, stats, sync } = useSyncStore();
  const { getActiveServer, loadConfig, isLoaded } = useSettingsStore();

  const activeServer = getActiveServer();
  const lastSyncTime = stats?.lastSyncTime || null;

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
  const fetchRemoteClipboard = async () => {
    if (!activeServer) {
      setRemoteContent(null);
      return;
    }

    setLoadingRemote(true);
    try {
      const apiClient = createAPIClient(activeServer);
      const profile = await apiClient.getClipboard();

      if (profile) {
        // 转换为 ClipboardContent
        const { profileDtoToContent } = await import('@/utils/clipboard');
        const content = profileDtoToContent(profile);
        setRemoteContent(content);
      } else {
        setRemoteContent(null);
      }
    } catch (error) {
      console.error('[HomeScreen] Failed to fetch remote clipboard:', error);
      setRemoteContent(null);
    } finally {
      setLoadingRemote(false);
    }
  };

  // 页面加载时加载配置和剪贴板内容
  useEffect(() => {
    const initialize = async () => {
      if (!isLoaded) {
        await loadConfig();
      }
      await getContent();
    };
    initialize();
  }, [isLoaded, loadConfig, getContent]);

  // 当服务器配置改变时，获取远程剪贴板
  useEffect(() => {
    if (activeServer) {
      fetchRemoteClipboard();
    } else {
      setRemoteContent(null);
    }
  }, [activeServer]);

  // 下拉刷新
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await getContent();
      if (activeServer) {
        await Promise.all([fetchRemoteClipboard(), sync(SyncDirection.Download)]);
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
      await fetchRemoteClipboard(); // 刷新远程剪贴板显示
      showMessage('剪贴板已上传到服务器', 'success');
    } catch (error: any) {
      showMessage(error.message || '无法上传到服务器', 'error');
    }
  };

  const handleDownload = async () => {
    if (!activeServer) {
      showMessage('请先在设置中配置服务器', 'info');
      return;
    }

    try {
      await sync(SyncDirection.Download);
      await getContent(); // 刷新本地剪贴板显示
      showMessage('已从服务器下载剪贴板', 'success');
    } catch (error: any) {
      showMessage(error.message || '无法从服务器下载', 'error');
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

  const handleSync = async () => {
    if (!activeServer) {
      showMessage('请先在设置中配置服务器', 'info');
      return;
    }

    try {
      await sync(SyncDirection.Both);
      // 刷新本地和远程显示
      await Promise.all([getContent(), fetchRemoteClipboard()]);
      showMessage('剪贴板已同步', 'success');
    } catch (error: any) {
      showMessage(error.message || '同步过程中出现错误', 'error');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* 状态指示器 */}
      <SyncStatusIndicator
        status={status}
        lastSyncTime={lastSyncTime}
        serverConnected={!!activeServer}
      />

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
                <View
                  style={[
                    styles.loadingCard,
                    { backgroundColor: theme.colors.surface },
                  ]}
                >
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
            <CurrentClipboardCard 
              clipboard={currentContent} 
              isRemote={false}
            />
          </>
        )}

        {/* 空状态提示 */}
        {!activeServer && (
          <View style={[styles.emptyState, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>
              未配置服务器
            </Text>
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
            <Text style={[styles.infoValue, { color: theme.colors.text }]}>
              {activeServer.url}
            </Text>
            <Text
              style={[
                styles.infoLabel,
                { color: theme.colors.textSecondary, marginTop: 8 },
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

      {/* 快速操作栏 */}
      <QuickActionsBar
        onUpload={handleUpload}
        onDownload={handleDownload}
        onSync={handleSync}
        disabled={!activeServer || status === SyncStatus.Syncing}
        syncInProgress={status === SyncStatus.Syncing}
      />
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
