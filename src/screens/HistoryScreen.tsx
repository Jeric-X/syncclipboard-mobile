/**
 * History Screen
 * 历史记录页面 - 显示剪贴板历史记录
 */

import React, { useEffect, useState, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  Share,
  Animated,
  Easing,
  ActivityIndicator,
  useWindowDimensions,
  BackHandler,
} from 'react-native';
import { Check, RefreshCw, List } from 'react-native-feather';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { TabView, TabBar, type Route } from 'react-native-tab-view';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { useHistoryStore } from '@/stores/historyStore';
import { useSettingsStore } from '@/stores';
import { historyStorage } from '@/storage';
import { useTransferQueueStore } from '@/stores/transferQueueStore';
import { useHistoryDisplaySettings } from '@/hooks/useHistoryDisplaySettings';
import {
  HistoryItem,
  ClipboardContent,
  createHistoryItem,
  isLocalFileReady,
} from '@/types/clipboard';
import { HistoryFilter } from '@/types/storage';
import { HistoryListItem } from '@/components/HistoryListItem';
import { MessageToast } from '@/components/MessageToast';
import { TopRightMenu, type MenuItemConfig } from '@/components/TopRightMenu';
import { TransferQueueModal } from '@/components/TransferQueueModal';
import { WordPickerScreen } from '@/screens/WordPickerScreen';
import { openFile, shareFile, saveToGallery } from '@/utils/fileActions';
import { isTextInvalid } from '@/utils/index';
import { saveContentDataToDirectory } from '@/utils/clipboard/clipboardContentUtils';
import { historyItemToContent } from '@/utils/clipboard/convert';
import { useMessageStore } from '@/stores/messageStore';
import { useErrorStore } from '@/stores/errorStore';
import * as FileSystem from 'expo-file-system/legacy';
import type { ProgressInfo } from 'native-util';
import { calculateTextHash } from '@/utils/hash';
import { createContentFromFile } from '@/utils/clipboard/clipboardContentUtils';
import { isHistorySyncEnabled } from '@/utils/config';
import { getHistorySyncService } from '@/services/history/HistorySyncService';

export function HistoryScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const { t } = useTranslation();

  const tabRoutes = useMemo<Route[]>(
    () => [
      { key: 'all', title: t('history.tabAll') },
      { key: 'Text', title: t('history.tabText') },
      { key: 'Image', title: t('history.tabImage') },
      { key: 'File', title: t('history.tabFile') },
      { key: 'starred', title: t('history.tabStarred') },
    ],
    [t]
  );
  const {
    items,
    loadItems,
    searchItems,
    addItems,
    clearHistory,
    toggleStar,
    lastAddedTimestamp,
    handleStorageChange,
    setSort,
    selectedIds,
    toggleSelection,
    clearSelection,
    deleteSelected,
  } = useHistoryStore();
  const { config } = useSettingsStore();

  const { showFullImage, setShowFullImage, showHistoryDebugInfo, setShowHistoryDebugInfo } =
    useHistoryDisplaySettings();
  const layout = useWindowDimensions();

  const [searchText, setSearchText] = useState('');
  const [tabIndex, setTabIndex] = useState(0);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [sortField, setSortField] = useState<'timestamp' | 'lastAccessed'>('timestamp');
  const { message, showMessage, clearMessage } = useMessageStore();
  const { setError } = useErrorStore();
  const isDebugMode = config?.debugMode ?? false;
  const [showTransferQueue, setShowTransferQueue] = useState(false);
  const [importingFile, setImportingFile] = useState(false);
  const [isReorganizing, setIsReorganizing] = useState(false);
  const [wordPickerText, setWordPickerText] = useState<string | null>(null);

  // 保存操作状态
  interface ActiveSaveState {
    profileHash: string;
    progress: ProgressInfo;
    abortController: AbortController;
  }
  const [activeSave, setActiveSave] = useState<ActiveSaveState | null>(null);

  const {
    hasTasks,
    pendingCount,
    activeCount,
    subscribe: subscribeTransferQueue,
  } = useTransferQueueStore();

  const historySyncEnabled = useMemo(() => isHistorySyncEnabled(config), [config]);

  // 加载排序设置并同步到 store
  useEffect(() => {
    const loadSortSetting = async () => {
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const savedSort = await AsyncStorage.getItem('@syncclipboard:history:sort_field');
        if (savedSort === 'timestamp' || savedSort === 'lastAccessed') {
          setSortField(savedSort);
          setSort({ field: savedSort, order: 'desc' });
        }
      } catch (error) {
        console.warn('[HistoryScreen] Failed to load sort setting:', error);
      }
    };
    loadSortSetting();
  }, [setSort]);

  useEffect(() => {
    return subscribeTransferQueue();
  }, [subscribeTransferQueue]);

  // 保存排序设置并重新加载数据
  const handleSortChange = useCallback(
    async (field: 'timestamp' | 'lastAccessed') => {
      setSortField(field);
      setSort({ field, order: 'desc' });
      try {
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        await AsyncStorage.setItem('@syncclipboard:history:sort_field', field);
      } catch (error) {
        console.warn('[HistoryScreen] Failed to save sort setting:', error);
      }
      loadItems();
    },
    [setSort, loadItems]
  );

  const listRef = useRef<FlashListRef<HistoryItem>>(null);

  // 已在历史记录页面时，再次点击导航栏按钮回到顶部
  useEffect(() => {
    const unsubscribe = (
      navigation as { addListener: (event: string, callback: () => void) => () => void }
    ).addListener('tabPress', () => {
      if (navigation.isFocused()) {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      }
    });
    return unsubscribe;
  }, [navigation]);

  // 搜索防抖（含初始加载）— 仅按关键词搜索，分类筛选由 TabView 在客户端完成
  useEffect(() => {
    if (isReorganizing) {
      return;
    }

    const timer = setTimeout(() => {
      const filter: HistoryFilter | undefined = searchText ? { keyword: searchText } : undefined;
      searchItems(filter);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchText, searchItems, isReorganizing]);

  // 监听新项目添加，滚动到顶部
  useEffect(() => {
    if (lastAddedTimestamp > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              listRef.current?.scrollToOffset({ offset: 0, animated: true });
            });
          });
        });
      });
    }
  }, [lastAddedTimestamp]);

  // 监听 HistoryStorage 变更，实时更新 UI
  useEffect(() => {
    const { historyService } = require('@/services/history');

    const handleChange = (
      items: HistoryItem[],
      action: import('@/storage/HistoryStorage').HistoryChangeAction
    ) => {
      handleStorageChange(items, action);
    };

    historyService.addChangeCallback(handleChange);

    return () => {
      historyService.removeChangeCallback(handleChange);
    };
  }, [handleStorageChange]);

  // 排序数据（排序已在 store 层面完成，这里直接返回）
  const sortedItems = useMemo(() => {
    return items;
  }, [items]);

  // ClipboardItem 转换为 ClipboardContent 后调用公共复制函数
  const copyItemWithSync = useCallback(async (item: HistoryItem) => {
    const content: ClipboardContent = {
      type: item.type,
      text: item.text,
      profileHash: item.profileHash,
      fileUri: item.fileUri,
      fileName: item.dataName,
      fileSize: item.size,
      timestamp: item.timestamp,
      localClipboardHash: item.localClipboardHash,
      hasData: item.hasData,
    };
    const { localClipboard } = await import('@/services');
    await localClipboard.setClipboardContent(content);
    // 更新 lastAccessed，使按访问时间排序时记录移到顶部
    historyStorage.updateLastAccessed(item.profileHash);
  }, []);

  // 点击列表项 - 复制到剪贴板
  const handleItemPress = useCallback(
    async (item: HistoryItem) => {
      try {
        await copyItemWithSync(item);
        showMessage(
          item.type === 'Image' ? t('clipboard.imageCopied') : t('clipboard.copied'),
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
    },
    [showMessage, copyItemWithSync]
  );

  // 分享项目
  const handleShare = useCallback(
    async (item: HistoryItem) => {
      try {
        if (item.type === 'Text' && !isTextInvalid(item.text)) {
          await Share.share({
            message: item.text,
            title: t('history.shareTextTitle'),
          });
        } else if (item.fileUri) {
          await shareFile(item.fileUri, item.dataName);
        } else {
          showMessage(t('history.shareNotSupported'), 'info');
        }
      } catch (error) {
        console.error('[HistoryScreen] Failed to share:', error);
        showMessage(t('history.shareFailed'), 'error');
      }
    },
    [showMessage]
  );

  // 取消保存
  const handleCancelSave = useCallback(() => {
    activeSave?.abortController.abort();
  }, [activeSave]);

  // 储存文件到设备（图片类型保存到相册）
  const handleSave = useCallback(
    async (item: HistoryItem) => {
      if (!item.fileUri) return;
      try {
        // 图片类型直接保存到相册
        if (item.type === 'Image') {
          await saveToGallery(item.fileUri);
          showMessage(t('clipboard.savedToGallery'), 'success');
          return;
        }

        // 其他类型：先选择文件夹
        const permissions =
          await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permissions.granted) {
          showMessage(t('history.saveCanceled'), 'info');
          return;
        }

        const abortController = new AbortController();
        setActiveSave({
          profileHash: item.profileHash,
          progress: { progress: 0, bytesTransferred: 0, totalBytes: 0 },
          abortController,
        });

        const content = historyItemToContent(item);
        await saveContentDataToDirectory(
          content,
          permissions.directoryUri,
          abortController.signal,
          (info) => {
            setActiveSave((prev) => (prev ? { ...prev, progress: info } : null));
          }
        );
        showMessage(t('clipboard.savedToDevice'), 'success');
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          // 用户取消，不显示错误
          return;
        }
        if (error instanceof Error && error.message === 'Media library permission denied') {
          showMessage(t('clipboard.galleryPermissionRequired'), 'error');
          return;
        }
        console.error('[HistoryScreen] Failed to save file:', error);
        showMessage(t('history.saveFailed'), 'error');
      } finally {
        setActiveSave(null);
      }
    },
    [showMessage]
  );

  // 打开文件
  const handleOpen = useCallback(
    async (item: HistoryItem) => {
      if (!item.fileUri) return;
      try {
        await openFile(item.fileUri);
      } catch (error) {
        console.error('[HistoryScreen] Failed to open file:', error);
        showMessage(t('history.openFailed'), 'error');
      }
    },
    [showMessage]
  );

  // 切换收藏状态
  const handleToggleStar = useCallback(
    async (item: HistoryItem) => {
      try {
        await toggleStar(item.profileHash);
        // 同步由 HistorySyncService.handleLocalHistoryChanged 自动处理
      } catch (error) {
        console.error('[HistoryScreen] Failed to toggle star:', error);
        showMessage(t('common.operationFailed'), 'error');
      }
    },
    [toggleStar, showMessage]
  );

  // 长按进入多选模式
  const handleItemLongPress = useCallback(
    (item: HistoryItem) => {
      if (!isMultiSelectMode) {
        setIsMultiSelectMode(true);
        clearSelection();
      }
      toggleSelection(item.profileHash);
    },
    [isMultiSelectMode, clearSelection, toggleSelection]
  );

  // 多选模式下点击 item 切换选中
  const handleMultiSelectPress = useCallback(
    (item: HistoryItem) => {
      toggleSelection(item.profileHash);
    },
    [toggleSelection]
  );

  // 退出多选模式
  const exitMultiSelectMode = useCallback(() => {
    setIsMultiSelectMode(false);
    clearSelection();
  }, [clearSelection]);

  // 多选模式下拦截系统返回键，退出多选而不是返回上一页
  useEffect(() => {
    if (!isMultiSelectMode) return;

    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      exitMultiSelectMode();
      return true;
    });
    return () => handler.remove();
  }, [isMultiSelectMode, exitMultiSelectMode]);

  // 批量删除
  const handleBatchDelete = useCallback(() => {
    const count = selectedIds.size;
    if (count === 0) return;
    Alert.alert(t('history.confirmDeleteTitle'), t('history.confirmDeleteMessage', { count }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteSelected();
          setIsMultiSelectMode(false);
        },
      },
    ]);
  }, [selectedIds.size, deleteSelected]);

  // 清空所有历史记录
  const handleClearAll = useCallback(() => {
    Alert.alert(t('history.confirmClearTitle'), t('history.confirmClearMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('history.clearConfirmBtn'),
        style: 'destructive',
        onPress: async () => {
          try {
            await clearHistory();
            const syncService = getHistorySyncService();
            await syncService.resetSyncCursor();
            showMessage(t('history.clearSuccess'), 'success');
          } catch (error) {
            console.error('[HistoryScreen] Failed to clear:', error);
            showMessage(t('history.clearFailed'), 'error');
          }
        },
      },
    ]);
  }, [clearHistory, showMessage]);

  // 添加文件到历史记录
  const handleImportFile = useCallback(async () => {
    try {
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

      const fileName = asset.name || 'file';

      setImportingFile(true);

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

      const content = await createContentFromFile(asset.uri, fileName, asset.mimeType, asset.size);
      const { historyService: hs } = await import('@/services/history');
      await hs.addLocalContent(content);

      showMessage(t('history.fileAdded', { fileName }), 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('history.addFileFailed');
      console.error('[HistoryScreen] Failed to import file:', error);
      showMessage(errorMessage, 'error');
    } finally {
      setImportingFile(false);
    }
  }, [showMessage]);

  // 添加图片到历史记录
  const handleImportImage = useCallback(async () => {
    try {
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

      const fileName = asset.fileName || `image_${Date.now()}.jpg`;

      setImportingFile(true);

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

      const content = await createContentFromFile(
        asset.uri,
        fileName,
        asset.mimeType,
        asset.fileSize
      );
      const { historyService: hs } = await import('@/services/history');
      await hs.addLocalContent(content);

      showMessage(t('history.imageAdded', { fileName }), 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('history.addImageFailed');
      console.error('[HistoryScreen] Failed to import image:', error);
      showMessage(errorMessage, 'error');
    } finally {
      setImportingFile(false);
    }
  }, [showMessage]);

  // 重新同步历史记录
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 同步动画
  const syncRotation = useRef(new Animated.Value(0)).current;
  const syncAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isSyncing) {
      syncRotation.setValue(0);
      const animation = Animated.loop(
        Animated.timing(syncRotation, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      animation.start();
      syncAnimationRef.current = animation;
    } else {
      syncAnimationRef.current?.stop();
      syncAnimationRef.current = null;
      syncRotation.setValue(0);
    }
  }, [isSyncing, syncRotation]);

  const syncRotationInterpolate = syncRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const handleResyncHistory = useCallback(async () => {
    if (isSyncing) return;

    const syncService = getHistorySyncService();
    if (!syncService.isInitialized()) {
      showMessage(t('history.syncNotInitialized'), 'error');
      return;
    }

    setIsSyncing(true);
    showMessage(t('history.syncStarted'), 'info');

    try {
      await syncService.syncAll((progress: { message?: string }) => {
        if (progress.message) {
          console.log(`[HistoryScreen] Sync progress: ${progress.message}`);
        }
      });
      showMessage(t('history.syncCompleted'), 'success');
    } catch (error) {
      console.error('[HistoryScreen] Failed to resync history:', error);
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      setError({
        title: t('history.syncFailedTitle'),
        message: errorMessage,
      });
      showMessage(t('history.syncFailedMessage', { error: errorMessage }), 'error');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, showMessage, setError]);

  const handleIncrementalSync = useCallback(
    async (isPullToRefresh = false) => {
      if (isSyncing) return;

      const syncService = getHistorySyncService();
      if (!syncService.isInitialized()) {
        return;
      }

      setIsSyncing(true);
      if (isPullToRefresh) {
        setIsRefreshing(true);
      }

      try {
        await syncService.syncIncremental();
      } catch (error) {
        console.error('[HistoryScreen] Failed to incremental sync:', error);
        const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
        setError({
          title: t('history.incrementalSyncFailedTitle'),
          message: errorMessage,
        });
      } finally {
        setIsSyncing(false);
        if (isPullToRefresh) {
          setIsRefreshing(false);
        }
      }
    },
    [isSyncing, setError]
  );

  useFocusEffect(
    useCallback(() => {
      const onScreenFocus = async () => {
        const currentConfig = useSettingsStore.getState().config;
        if (currentConfig?.needsHistoryReorganize) {
          const latestConfig = useSettingsStore.getState().config;
          const shouldReorganize = !isHistorySyncEnabled(latestConfig);

          if (!shouldReorganize) {
            console.log('[HistoryScreen] Skipped history reorganization (sync re-enabled)');
            await useSettingsStore.getState().updateConfig({ needsHistoryReorganize: false });
          } else {
            setIsReorganizing(true);
            console.log('[HistoryScreen] Starting history reorganization...');

            const { HistoryStorage } = await import('@/storage/HistoryStorage');
            const { historyService } = await import('@/services/history');
            const historyStorage = HistoryStorage.getInstance();
            const syncService = getHistorySyncService();

            const abortController = new AbortController();
            syncService.setReorganizeAbortController(abortController);

            historyService.beginSilentMode();

            try {
              await syncService.cleanupRemoteHistorys(abortController.signal);
              await historyStorage.cleanupByCount();
              console.log('[HistoryScreen] History reorganization completed');
              await useSettingsStore.getState().updateConfig({ needsHistoryReorganize: false });
            } catch (error) {
              if (error instanceof DOMException && error.name === 'AbortError') {
                console.log('[HistoryScreen] History reorganization cancelled');
              } else {
                console.error('[HistoryScreen] History reorganization failed:', error);
              }
            } finally {
              syncService.setReorganizeAbortController(null);
              setIsReorganizing(false);
              historyService.endSilentMode();
              await useHistoryStore.getState().refresh();
            }
          }
        }

        if (historySyncEnabled) {
          console.log('[HistoryScreen] Screen focused, starting incremental sync');
          const syncService = getHistorySyncService();
          if (syncService.isInitialized()) {
            if (syncService.isSyncInProgress()) {
              console.log('[HistoryScreen] Sync already in progress, showing indicator');
              setIsSyncing(true);
              const progressCallback = (progress: { phase: string }) => {
                if (progress.phase === 'completed' || progress.phase === 'error') {
                  syncService.removeProgressCallback(progressCallback);
                  setIsSyncing(false);
                }
              };
              syncService.addProgressCallback(progressCallback);
            } else {
              setIsSyncing(true);
              try {
                await syncService.syncIncremental();
              } catch (error) {
                console.error('[HistoryScreen] Failed to incremental sync:', error);
                const errorMessage =
                  error instanceof Error ? error.message : t('common.unknownError');
                setError({
                  title: t('history.incrementalSyncFailedTitle'),
                  message: errorMessage,
                });
              } finally {
                setIsSyncing(false);
              }
            }
          }
        }
      };

      onScreenFocus();
    }, [historySyncEnabled])
  );

  const generateRandomDebugText = useCallback(() => {
    const randomInt = (min: number, max: number) =>
      Math.floor(Math.random() * (max - min + 1)) + min;

    const totalChars = randomInt(0, 100);
    const lineCount = randomInt(0, 5);

    if (totalChars === 0 || lineCount === 0) {
      return '';
    }

    const chars =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789，。！？；：、-_[](){}<>/\\@#%&*+= 空格测试随机内容';

    const buildLine = (length: number) => {
      let line = '';
      for (let i = 0; i < length; i++) {
        const index = randomInt(0, chars.length - 1);
        line += chars[index];
      }
      return line;
    };

    let remaining = totalChars;
    const lines: string[] = [];

    for (let i = 0; i < lineCount; i++) {
      const isLastLine = i === lineCount - 1;
      const currentLength = isLastLine ? remaining : randomInt(0, remaining);
      lines.push(buildLine(currentLength));
      remaining -= currentLength;
    }

    return lines.join('\n');
  }, []);

  const handleAddRandomRecords = useCallback(async () => {
    try {
      const now = Date.now();
      const randomItems = await Promise.all(
        Array.from({ length: 10 }, async (_unused, index) => {
          const seed = `debug-random-${now}-${index}-${Math.random().toString(36).slice(2, 10)}`;
          const profileHash = await calculateTextHash(seed);

          return createHistoryItem({
            type: 'Text' as const,
            text: generateRandomDebugText(),
            profileHash,
            hasData: false,
            timestamp: now - index * 1000,
          });
        })
      );

      await addItems(randomItems);

      showMessage(t('history.addedRandomRecords'), 'success');
    } catch (error) {
      console.error('[HistoryScreen] Failed to add random records:', error);
      showMessage(t('history.addRandomFailed'), 'error');
    }
  }, [addItems, showMessage, generateRandomDebugText]);

  // 加载更多已移除：虚拟列表性能足够，不再需要分页
  const handleEndReached = useCallback(() => {
    // no-op: 已移除分页，所有数据一次性加载
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchText('');
  }, []);

  // 切换完整图片显示
  const handleToggleFullImage = useCallback(async () => {
    await setShowFullImage(!showFullImage);
  }, [showFullImage, setShowFullImage]);

  const handleToggleHistoryDebugInfo = useCallback(async () => {
    await setShowHistoryDebugInfo(!showHistoryDebugInfo);
  }, [showHistoryDebugInfo, setShowHistoryDebugInfo]);

  const handleDownload = useCallback(
    async (item: HistoryItem) => {
      console.log(`[HistoryScreen] ========== Download Button Clicked ==========`);
      console.log(`[HistoryScreen] Item profileHash: ${item.profileHash}`);
      console.log(`[HistoryScreen] Item type: ${item.type}`);
      console.log(`[HistoryScreen] Item dataName: ${item.dataName}`);
      console.log(`[HistoryScreen] Item hasRemoteData: ${item.hasRemoteData}`);
      console.log(`[HistoryScreen] Item isLocalFileReady: ${isLocalFileReady(item)}`);

      if (!getHistorySyncService().isInitialized()) {
        showMessage(t('history.syncNotEnabled'), 'error');
        return;
      }

      const { getHistoryTransferQueue } = await import('@/services/history/HistoryTransferQueue');
      const { getProfileId } = await import('@/utils');

      const profileId = getProfileId(item.type, item.profileHash);
      console.log(`[HistoryScreen] Generated profileId: ${profileId}`);

      const queue = getHistoryTransferQueue();
      queue.start();
      await queue.addDownloadTask(profileId);
    },
    [showMessage]
  );

  const handleUpload = useCallback(
    async (item: HistoryItem) => {
      console.log(`[HistoryScreen] ========== Upload Button Clicked ==========`);
      console.log(`[HistoryScreen] Item profileHash: ${item.profileHash}`);
      console.log(`[HistoryScreen] Item type: ${item.type}`);
      console.log(`[HistoryScreen] Item isLocalFileReady: ${isLocalFileReady(item)}`);
      console.log(`[HistoryScreen] Item syncStatus: ${item.syncStatus}`);

      if (!getHistorySyncService().isInitialized()) {
        showMessage(t('history.syncNotEnabled'), 'error');
        return;
      }

      // 验证本地文件是否存在
      if (item.fileUri) {
        const { File } = await import('expo-file-system');
        const file = new File(item.fileUri);
        if (!file.exists) {
          console.warn(`[HistoryScreen] Local file not found: ${item.fileUri}`);
          showMessage(t('history.localFileNotFound'), 'error');
          return;
        }
      }

      const { getHistoryTransferQueue } = await import('@/services/history/HistoryTransferQueue');
      const { getProfileId } = await import('@/utils');

      const profileId = getProfileId(item.type, item.profileHash);
      console.log(`[HistoryScreen] Generated profileId: ${profileId}`);

      const queue = getHistoryTransferQueue();
      queue.start();
      await queue.addUploadTask(profileId);
    },
    [showMessage]
  );

  const renderItem = useCallback(
    ({ item }: { item: HistoryItem }) => {
      return (
        <HistoryListItem
          item={item}
          onCopy={handleItemPress}
          onShare={handleShare}
          onSave={handleSave}
          onOpen={handleOpen}
          onLongPress={handleItemLongPress}
          onPress={handleMultiSelectPress}
          onToggleStar={handleToggleStar}
          onDownload={historySyncEnabled ? handleDownload : undefined}
          onUpload={historySyncEnabled ? handleUpload : undefined}
          onWordPick={setWordPickerText}
          showFullImage={showFullImage}
          showDebugInfo={isDebugMode && showHistoryDebugInfo}
          enableHistorySync={historySyncEnabled}
          isMultiSelectMode={isMultiSelectMode}
          isSelected={selectedIds.has(item.profileHash)}
          showImageCopyButton={config?.showImageCopyButton ?? false}
          activeSaveHash={activeSave?.profileHash}
          saveProgress={activeSave?.progress}
          onCancelSave={handleCancelSave}
        />
      );
    },
    [
      handleItemPress,
      handleShare,
      handleSave,
      handleOpen,
      handleItemLongPress,
      handleMultiSelectPress,
      handleToggleStar,
      handleDownload,
      handleUpload,
      showFullImage,
      isDebugMode,
      showHistoryDebugInfo,
      historySyncEnabled,
      isMultiSelectMode,
      selectedIds,
      config?.showImageCopyButton,
      activeSave,
      handleCancelSave,
    ]
  );

  // 渲染空状态
  const renderEmptyComponent = useCallback(() => {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📋</Text>
        <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{t('history.empty')}</Text>
        <Text style={[styles.emptyDescription, { color: theme.colors.textSecondary }]}>
          {searchText ? t('history.notFound') : t('history.emptyHint')}
        </Text>
      </View>
    );
  }, [theme, searchText]);

  // 客户端分类筛选
  const filteredItemsByTab = useMemo(() => {
    const result: Record<string, HistoryItem[]> = {
      all: sortedItems,
      Text: sortedItems.filter((item) => item.type === 'Text'),
      Image: sortedItems.filter((item) => item.type === 'Image'),
      File: sortedItems.filter((item) => item.type === 'File' || item.type === 'Group'),
      starred: sortedItems.filter((item) => item.starred),
    };
    return result;
  }, [sortedItems]);

  // 全选当前分类的项目
  const handleSelectAllInCurrentTab = useCallback(() => {
    const currentTabKey = tabRoutes[tabIndex]?.key;
    if (!currentTabKey) return;

    const currentTabItems = filteredItemsByTab[currentTabKey] || [];
    const newSelectedIds = new Set(currentTabItems.map((item) => item.profileHash));

    // 直接设置 selectedIds
    useHistoryStore.setState({ selectedIds: newSelectedIds });
  }, [tabRoutes, tabIndex, filteredItemsByTab]);

  // 取消全选当前分类的项目（保留其他分类的选中状态）
  const handleClearSelectionInCurrentTab = useCallback(() => {
    const currentTabKey = tabRoutes[tabIndex]?.key;
    if (!currentTabKey) return;

    const currentTabItems = filteredItemsByTab[currentTabKey] || [];
    const currentTabIds = new Set(currentTabItems.map((item) => item.profileHash));

    // 从 selectedIds 中移除当前分类的项目
    const newSelectedIds = new Set(selectedIds);
    currentTabIds.forEach((id) => newSelectedIds.delete(id));

    // 更新 selectedIds
    useHistoryStore.setState({ selectedIds: newSelectedIds });
  }, [tabRoutes, tabIndex, filteredItemsByTab, selectedIds]);

  // 渲染每个 Tab 的内容
  const renderScene = useCallback(
    ({ route }: { route: Route }) => {
      const tabItems = filteredItemsByTab[route.key] || [];
      return (
        <FlashList
          ref={route.key === tabRoutes[tabIndex]?.key ? listRef : undefined}
          data={tabItems}
          renderItem={renderItem}
          keyExtractor={(item) => item.profileHash}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={renderEmptyComponent}
          contentContainerStyle={styles.listContent}
          refreshing={isRefreshing}
          onRefresh={historySyncEnabled ? () => handleIncrementalSync(true) : undefined}
        />
      );
    },
    [
      filteredItemsByTab,
      tabIndex,
      renderItem,
      handleEndReached,
      renderEmptyComponent,
      isRefreshing,
      historySyncEnabled,
      handleIncrementalSync,
    ]
  );

  // 自定义 TabBar
  const renderTabBar = useCallback(
    (props: Parameters<NonNullable<React.ComponentProps<typeof TabView>['renderTabBar']>>[0]) => (
      <TabBar
        {...props}
        style={[styles.tabBar, { backgroundColor: theme.colors.surface }]}
        indicatorStyle={[styles.tabIndicator, { backgroundColor: theme.colors.primary }]}
        activeColor={theme.colors.primary}
        inactiveColor={theme.colors.textSecondary}
        pressColor={theme.colors.border}
      />
    ),
    [theme]
  );

  // 菜单项配置
  const menuItems = useMemo<MenuItemConfig[]>(() => {
    const items: MenuItemConfig[] = [
      {
        label: t('history.addImage'),
        onPress: handleImportImage,
      },
      {
        label: t('history.addFile'),
        onPress: handleImportFile,
      },
      {
        label: t('history.showFullImage'),
        onPress: handleToggleFullImage,
        icon: showFullImage ? <Check color="#2196F3" width={18} height={18} /> : undefined,
      },
      {
        label: t('history.sortBy'),
        submenu: [
          {
            label: t('history.sortByTime'),
            onPress: () => handleSortChange('timestamp'),
            icon:
              sortField === 'timestamp' ? (
                <Check color="#2196F3" width={18} height={18} />
              ) : undefined,
          },
          {
            label: t('history.sortByAccess'),
            onPress: () => handleSortChange('lastAccessed'),
            icon:
              sortField === 'lastAccessed' ? (
                <Check color="#2196F3" width={18} height={18} />
              ) : undefined,
          },
        ],
      },
    ];

    if (historySyncEnabled) {
      items.push({
        label: isSyncing ? t('history.syncing') : t('history.resync'),
        onPress: handleResyncHistory,
        disabled: isSyncing,
      });
    }

    if (isDebugMode) {
      items.push({
        label: t('history.showDebugInfo'),
        onPress: handleToggleHistoryDebugInfo,
        icon: showHistoryDebugInfo ? <Check color="#2196F3" width={18} height={18} /> : undefined,
      });
      items.push({
        label: t('history.addRandomRecords'),
        onPress: handleAddRandomRecords,
      });
    }

    items.push({
      label: t('history.clearAll'),
      onPress: handleClearAll,
      destructive: true,
    });

    return items;
  }, [
    showFullImage,
    sortField,
    isDebugMode,
    showHistoryDebugInfo,
    isSyncing,
    historySyncEnabled,
    handleImportImage,
    handleImportFile,
    handleToggleFullImage,
    handleToggleHistoryDebugInfo,
    handleSortChange,
    handleResyncHistory,
    handleAddRandomRecords,
    handleClearAll,
  ]);

  // 设置标题栏菜单按钮
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShadowVisible: false,
      headerStyle: {
        backgroundColor: theme.colors.surface,
        elevation: 0,
        shadowOpacity: 0,
        borderBottomWidth: 0,
      },
      headerRight: () => (
        <View style={styles.headerRightContainer}>
          {hasTasks && (
            <TouchableOpacity
              style={styles.queueButton}
              onPress={() => setShowTransferQueue(true)}
              hitSlop={{ top: 10, right: 5, bottom: 10, left: 5 }}
            >
              <List width={20} height={20} color={theme.colors.primary} />
              <View style={[styles.queueBadge, { backgroundColor: theme.colors.primary }]}>
                <Text style={[styles.queueBadgeText, { color: theme.colors.white }]}>
                  {activeCount + pendingCount}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          {isSyncing && (
            <Animated.View
              style={[styles.syncIndicator, { transform: [{ rotate: syncRotationInterpolate }] }]}
            >
              <RefreshCw width={18} height={18} color={theme.colors.primary} />
            </Animated.View>
          )}
          {!isReorganizing && <TopRightMenu items={menuItems} />}
        </View>
      ),
    });
  }, [
    navigation,
    theme.colors.surface,
    theme.colors.primary,
    theme.colors.textSecondary,
    menuItems,
    isSyncing,
    syncRotationInterpolate,
    hasTasks,
    activeCount,
    pendingCount,
    isReorganizing,
  ]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* 整理中提示 */}
      {isReorganizing && (
        <View style={[styles.reorganizingOverlay, { backgroundColor: theme.colors.background }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.reorganizingText, { color: theme.colors.text }]}>
            {t('history.reorganizing')}
          </Text>
        </View>
      )}
      {/* 搜索栏 */}
      <View style={[styles.searchContainer, { backgroundColor: theme.colors.surface }]}>
        <TextInput
          style={[
            styles.searchInput,
            {
              backgroundColor: theme.colors.background,
              color: theme.colors.text,
              borderColor: theme.colors.border,
            },
          ]}
          placeholder={t('history.searchPlaceholder')}
          placeholderTextColor={theme.colors.textSecondary}
          value={searchText}
          onChangeText={setSearchText}
          clearButtonMode="while-editing"
        />
        <TouchableOpacity
          style={styles.clearSearchButton}
          onPress={handleClearSearch}
          disabled={!searchText}
        >
          <Text
            style={[
              styles.clearSearchButtonText,
              {
                color: searchText ? theme.colors.primary : theme.colors.textTertiary,
              },
            ]}
          >
            {t('common.clearSearch')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 分类 TabView */}
      <TabView
        navigationState={{ index: tabIndex, routes: tabRoutes }}
        renderScene={renderScene}
        onIndexChange={setTabIndex}
        initialLayout={{ width: layout.width }}
        renderTabBar={renderTabBar}
        lazy
      />

      {/* 多选操作栏 */}
      {isMultiSelectMode && (
        <View
          style={[
            styles.multiSelectBar,
            { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
          ]}
        >
          <Text style={[styles.multiSelectCount, { color: theme.colors.text }]}>
            {t('history.selectedCount', { count: selectedIds.size })}
          </Text>
          <TouchableOpacity onPress={exitMultiSelectMode} style={styles.multiSelectButton}>
            <Ionicons name="close" size={22} color={theme.colors.text} />
            <Text style={[styles.multiSelectButtonText, { color: theme.colors.text }]}>
              {t('common.cancel')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              const currentTabKey = tabRoutes[tabIndex]?.key;
              const currentTabItems = currentTabKey ? filteredItemsByTab[currentTabKey] || [] : [];
              const isAllSelected =
                currentTabItems.length > 0 &&
                currentTabItems.every((item) => selectedIds.has(item.profileHash));

              if (isAllSelected) {
                handleClearSelectionInCurrentTab();
              } else {
                handleSelectAllInCurrentTab();
              }
            }}
            style={styles.multiSelectButton}
          >
            <Ionicons
              name={(() => {
                const currentTabKey = tabRoutes[tabIndex]?.key;
                const currentTabItems = currentTabKey
                  ? filteredItemsByTab[currentTabKey] || []
                  : [];
                return currentTabItems.length > 0 &&
                  currentTabItems.every((item) => selectedIds.has(item.profileHash))
                  ? 'checkbox'
                  : 'checkbox-outline';
              })()}
              size={22}
              color={theme.colors.primary}
            />
            <Text style={[styles.multiSelectButtonText, { color: theme.colors.primary }]}>
              {t('common.selectAll')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleBatchDelete}
            style={styles.multiSelectButton}
            disabled={selectedIds.size === 0}
          >
            <Ionicons
              name="trash-outline"
              size={22}
              color={
                selectedIds.size > 0 ? theme.colors.error || '#F44336' : theme.colors.textTertiary
              }
            />
            <Text
              style={[
                styles.multiSelectButtonText,
                {
                  color:
                    selectedIds.size > 0
                      ? theme.colors.error || '#F44336'
                      : theme.colors.textTertiary,
                },
              ]}
            >
              {t('common.delete')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 传输队列弹窗 */}
      <TransferQueueModal visible={showTransferQueue} onClose={() => setShowTransferQueue(false)} />

      {/* 消息提示 */}
      <MessageToast message={message} onMessageShown={clearMessage} />

      {/* 导入文件遮罩 */}
      {importingFile && (
        <View style={[styles.importOverlay, { backgroundColor: theme.colors.backdrop }]}>
          <View style={[styles.importOverlayCard, { backgroundColor: theme.colors.surface }]}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[styles.importOverlayTitle, { color: theme.colors.text }]}>
              正在添加文件...
            </Text>
          </View>
        </View>
      )}

      {/* 分词选择页面 */}
      {wordPickerText && (
        <View style={StyleSheet.absoluteFill}>
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
  reorganizingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  reorganizingText: {
    marginTop: 16,
    fontSize: 16,
  },
  headerRightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  syncIndicator: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  queueButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  queueBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  queueBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    paddingTop: 0,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    borderWidth: 1,
  },
  clearSearchButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  clearSearchButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  tabBar: {
    elevation: 0,
    shadowOpacity: 0,
  },
  tabIndicator: {
    height: 3,
    borderRadius: 1.5,
    width: 24,
    marginHorizontal: 'auto',
  },
  tab: {
    width: 'auto',
    paddingHorizontal: 16,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '500',
    textTransform: 'none',
  },
  listContent: {
    paddingVertical: 8,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyDescription: {
    fontSize: 15,
    textAlign: 'center',
  },
  // 多选操作栏样式
  multiSelectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  multiSelectButton: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  multiSelectButtonText: {
    fontSize: 11,
    marginTop: 2,
  },
  multiSelectCount: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'left',
    paddingLeft: 8,
  },
  importOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  importOverlayCard: {
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    minWidth: 160,
  },
  importOverlayTitle: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
  },
});
