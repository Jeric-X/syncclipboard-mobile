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
  ActionSheetIOS,
  Platform,
  Modal,
  Pressable,
  Share,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Animated,
  Easing,
} from 'react-native';
import { Check } from 'react-native-feather';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '@/hooks/useTheme';
import { useHistoryStore } from '@/stores/historyStore';
import { useSettingsStore } from '@/stores';
import { useHistoryDisplaySettings } from '@/hooks/useHistoryDisplaySettings';
import { ClipboardItem, ClipboardContent } from '@/types/clipboard';
import { HistoryListItem, type HistoryListItemHandle } from '@/components/HistoryListItem';
import { MessageToast } from '@/components/MessageToast';
import { TopRightMenu, type MenuItemConfig } from '@/components/TopRightMenu';
import { copyToLocalClipboard } from '@/utils/clipboard';
import { openFile } from '@/utils/fileActions';
import { useMessageToast } from '@/hooks/useMessageToast';
import { calculateTextHash } from '@/utils/hash';

type FilterType = 'all' | 'Text' | 'Image' | 'File';

export function HistoryScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const {
    items,
    totalCount,
    isLoading,
    loadItems,
    searchItems,
    addItems,
    deleteItem,
    clearHistory,
    currentPage,
    lastAddedTimestamp,
  } = useHistoryStore();
  const { config } = useSettingsStore();

  const { showFullImage, setShowFullImage } = useHistoryDisplaySettings();

  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [selectedItem, setSelectedItem] = useState<ClipboardItem | null>(null);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const { message, showMessage, handleMessageShown } = useMessageToast();
  const actionSheetTranslateY = useRef(new Animated.Value(320)).current;
  const isDebugMode = config?.debugMode ?? false;

  const listRef = useRef<FlashListRef<ClipboardItem>>(null);
  const isScrolledRef = useRef(false);
  const itemRefsMap = useRef<Map<string, React.RefObject<HistoryListItemHandle | null>>>(
    new Map()
  ).current;

  // 清理不在列表中的 ref
  useEffect(() => {
    const currentHashes = new Set(items.map((item) => item.profileHash));
    for (const hash of itemRefsMap.keys()) {
      if (!currentHashes.has(hash)) {
        itemRefsMap.delete(hash);
      }
    }
  }, [items, itemRefsMap]);

  // 获取或创建 ref
  const getOrCreateItemRef = useCallback(
    (profileHash: string) => {
      let itemRef = itemRefsMap.get(profileHash);
      if (!itemRef) {
        itemRef = React.createRef<HistoryListItemHandle>();
        itemRefsMap.set(profileHash, itemRef as React.RefObject<HistoryListItemHandle | null>);
      }
      return itemRef as React.RefObject<HistoryListItemHandle>;
    },
    [itemRefsMap]
  );

  const openActionSheet = useCallback(() => {
    actionSheetTranslateY.setValue(320);
    setShowActionSheet(true);
    requestAnimationFrame(() => {
      Animated.timing(actionSheetTranslateY, {
        toValue: 0,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [actionSheetTranslateY]);

  const closeActionSheet = useCallback(
    (onClosed?: () => void) => {
      Animated.timing(actionSheetTranslateY, {
        toValue: 320,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setShowActionSheet(false);
          onClosed?.();
        }
      });
    },
    [actionSheetTranslateY]
  );

  // 搜索防抖（含初始加载）
  useEffect(() => {
    const timer = setTimeout(() => {
      // 统一使用 searchItems：有关键词时过滤，无关键词时传 undefined 以清除旧 filter 并加载全部
      searchItems(searchText ? { keyword: searchText } : undefined);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchText, searchItems]);

  // 监听新项目添加，如果列表未滚动则滚动到顶部
  useEffect(() => {
    if (lastAddedTimestamp > 0 && !isScrolledRef.current) {
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

  // 滚动事件处理
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    isScrolledRef.current = offsetY > 10;
  }, []);

  // 过滤数据
  const filteredItems = useMemo(() => {
    if (filterType === 'all') {
      return items;
    }
    return items.filter((item) => item.type === filterType);
  }, [items, filterType]);

  // ClipboardItem 转换为 ClipboardContent 后调用公共复制函数
  const copyItemWithSync = useCallback(async (item: ClipboardItem) => {
    // 构建 ClipboardContent
    // 对于Text类型的hasData，不在内存中读取完整文本，只设置fileUri
    // 完整文本的读取将在 copyToLocalClipboard 中进行
    const content: ClipboardContent = {
      type: item.type,
      text: item.text, // 预览文本或完整文本（如果hasData为false）
      profileHash: item.profileHash,
      fileUri: item.fileUri, // 对于hasData为true且需要完整文本的情况，使用fileUri
      fileName: item.dataName,
      fileSize: item.size,
      timestamp: item.timestamp,
      localClipboardHash: item.localClipboardHash,
      hasData: item.hasData, // 添加 hasData 字段
    };
    return copyToLocalClipboard(content);
  }, []);

  // 点击列表项 - 复制到剪贴板
  const handleItemPress = useCallback(
    async (item: ClipboardItem) => {
      const result = await copyItemWithSync(item);
      if (result.success) {
        showMessage(result.message, 'success');
      } else {
        showMessage(result.message || '复制失败', 'error');
      }
    },
    [showMessage, copyItemWithSync]
  );

  // 复制项目
  const handleCopyItem = useCallback(
    async (item: ClipboardItem) => {
      const result = await copyItemWithSync(item);
      showMessage(result.message, result.success ? 'success' : 'error');
      closeActionSheet();
    },
    [showMessage, copyItemWithSync, closeActionSheet]
  );

  // 真正执行删除的函数 - 与存储交互
  const performDelete = useCallback(
    async (item: ClipboardItem) => {
      try {
        await deleteItem(item.profileHash);
        showMessage('已删除', 'success');
      } catch (error) {
        console.error('[HistoryScreen] Failed to delete:', error);
        showMessage('删除失败', 'error');
      }
    },
    [deleteItem, showMessage]
  );

  // 菜单删除处理 - 触发 UI 动画，由 HistoryListItem 的 onDelete 执行真正删除
  const handleDeleteFromMenu = useCallback(
    (item: ClipboardItem) => {
      // 关闭操作表单
      closeActionSheet();

      // 触发 item 的删除动画，动画完成后会自动调用 onDelete (performDelete)
      const itemRef = itemRefsMap.get(item.profileHash);
      if (itemRef?.current) {
        itemRef.current.startDelete();
      }
    },
    [itemRefsMap, closeActionSheet]
  );

  // 分享项目
  const handleShare = useCallback(
    async (item: ClipboardItem) => {
      try {
        if (item.type === 'Text' && item.text) {
          await Share.share({
            message: item.text,
            title: '分享文本',
          });
        } else if (item.type === 'Image' && item.fileUri) {
          await Share.share({
            url: item.fileUri,
            title: '分享图片',
          });
        } else if ((item.type === 'File' || item.type === 'Group') && item.fileUri) {
          await Share.share({
            url: item.fileUri,
            title: '分享文件',
          });
        } else {
          showMessage('暂不支持分享此类型的内容', 'info');
        }
      } catch (error) {
        console.error('[HistoryScreen] Failed to share:', error);
        showMessage('分享失败', 'error');
      }
    },
    [showMessage]
  );

  // 打开文件
  const handleOpen = useCallback(
    async (item: ClipboardItem) => {
      if (!item.fileUri) return;
      try {
        await openFile(item.fileUri);
      } catch (error) {
        console.error('[HistoryScreen] Failed to open file:', error);
        showMessage('打开失败', 'error');
      }
    },
    [showMessage]
  );

  // 长按列表项 - 显示操作菜单
  const handleItemLongPress = useCallback(
    (item: ClipboardItem) => {
      setSelectedItem(item);

      if (Platform.OS === 'ios') {
        // 根据类型构建菜单选项
        const options: string[] = ['取消'];
        const actions: Array<() => void> = [];

        // Text: 复制、删除
        // Image: 分享、复制、删除
        // File/Group: 分享、删除

        if (item.type === 'Image' || item.type === 'File' || item.type === 'Group') {
          options.push('分享');
          actions.push(() => handleShare(item));
        }

        if (item.type === 'Text' || item.type === 'Image') {
          options.push('复制');
          actions.push(() => handleCopyItem(item));
        }

        options.push('删除');
        actions.push(() => handleDeleteFromMenu(item));

        ActionSheetIOS.showActionSheetWithOptions(
          {
            options,
            destructiveButtonIndex: options.length - 1, // 删除始终是最后一项
            cancelButtonIndex: 0,
          },
          (buttonIndex) => {
            if (buttonIndex > 0 && buttonIndex <= actions.length) {
              actions[buttonIndex - 1]();
            }
          }
        );
      } else {
        openActionSheet();
      }
    },
    [handleCopyItem, handleShare, handleDeleteFromMenu, openActionSheet]
  );

  // 清空所有历史记录
  const handleClearAll = useCallback(() => {
    Alert.alert('确认清空', '确定要清空所有历史记录吗？此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          try {
            await clearHistory();
            showMessage('已清空所有历史记录', 'success');
          } catch (error) {
            console.error('[HistoryScreen] Failed to clear:', error);
            showMessage('清空失败', 'error');
          }
        },
      },
    ]);
  }, [clearHistory, showMessage]);

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

          return {
            type: 'Text' as const,
            text: generateRandomDebugText(),
            profileHash,
            hasData: false,
            timestamp: now - index * 1000,
            synced: false,
          };
        })
      );

      await addItems(randomItems);

      showMessage('已添加10条随机记录', 'success');
    } catch (error) {
      console.error('[HistoryScreen] Failed to add random records:', error);
      showMessage('添加随机记录失败', 'error');
    }
  }, [addItems, showMessage, generateRandomDebugText]);

  // 加载更多（防止重复加载和越界）
  const handleEndReached = useCallback(() => {
    if (isLoading) return;
    if (items.length >= totalCount) return;
    loadItems(currentPage + 1);
  }, [isLoading, items.length, totalCount, currentPage, loadItems]);

  // 切换筛选类型
  const handleFilterChange = useCallback((type: FilterType) => {
    setFilterType(type);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchText('');
  }, []);

  // 切换完整图片显示
  const handleToggleFullImage = useCallback(async () => {
    await setShowFullImage(!showFullImage);
  }, [showFullImage, setShowFullImage]);

  // 渲染列表项
  const renderItem = useCallback(
    ({ item }: { item: ClipboardItem }) => {
      const itemRef = getOrCreateItemRef(item.profileHash);

      return (
        <HistoryListItem
          ref={itemRef}
          item={item}
          onCopy={handleItemPress}
          onShare={handleShare}
          onOpen={handleOpen}
          onLongPress={handleItemLongPress}
          onDelete={performDelete}
          showFullImage={showFullImage}
        />
      );
    },
    [
      getOrCreateItemRef,
      handleItemPress,
      handleShare,
      handleOpen,
      handleItemLongPress,
      performDelete,
      showFullImage,
    ]
  );

  // 渲染空状态
  const renderEmptyComponent = useCallback(() => {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📋</Text>
        <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>暂无历史记录</Text>
        <Text style={[styles.emptyDescription, { color: theme.colors.textSecondary }]}>
          {searchText ? '未找到匹配的记录' : '复制内容后将自动保存到历史记录'}
        </Text>
      </View>
    );
  }, [theme, searchText]);

  // 菜单项配置
  const menuItems = useMemo<MenuItemConfig[]>(() => {
    const items: MenuItemConfig[] = [
      {
        label: '展示完整图片',
        onPress: handleToggleFullImage,
        icon: showFullImage ? <Check color="#2196F3" width={18} height={18} /> : undefined,
      },
    ];

    if (isDebugMode) {
      items.push({
        label: '添加10条随机记录',
        onPress: handleAddRandomRecords,
      });
    }

    items.push({
      label: '清空所有历史记录',
      onPress: handleClearAll,
      destructive: true,
    });

    return items;
  }, [showFullImage, isDebugMode, handleToggleFullImage, handleAddRandomRecords, handleClearAll]);

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
      headerRight: () => <TopRightMenu items={menuItems} />,
    });
  }, [navigation, theme.colors.surface, menuItems]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
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
          placeholder="搜索历史记录..."
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
            清除
          </Text>
        </TouchableOpacity>
      </View>

      {/* 筛选按钮 */}
      <View style={[styles.filterContainer, { backgroundColor: theme.colors.surface }]}>
        {(['all', 'Text', 'Image', 'File'] as FilterType[]).map((type) => (
          <TouchableOpacity
            key={type}
            onPress={() => handleFilterChange(type)}
            style={[
              styles.filterButton,
              filterType === type
                ? { backgroundColor: theme.colors.primary }
                : styles.filterButtonInactive,
            ]}
          >
            <Text
              style={[
                styles.filterButtonText,
                { color: filterType === type ? theme.colors.white : theme.colors.textSecondary },
              ]}
            >
              {type === 'all'
                ? '全部'
                : type === 'Text'
                ? '文本'
                : type === 'Image'
                ? '图片'
                : '文件'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 历史记录列表 */}
      <FlashList
        ref={listRef}
        data={filteredItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.profileHash}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        onScroll={handleScroll}
        ListEmptyComponent={renderEmptyComponent}
        contentContainerStyle={styles.listContent}
      />

      {/* Android 操作菜单 Modal */}
      {Platform.OS === 'android' && (
        <Modal
          visible={showActionSheet}
          transparent
          animationType="none"
          onRequestClose={() => closeActionSheet()}
        >
          <Pressable
            style={[styles.modalOverlay, { backgroundColor: theme.colors.backdrop }]}
            onPress={() => closeActionSheet()}
          >
            <Animated.View
              style={[
                styles.actionSheet,
                {
                  backgroundColor: theme.colors.surface,
                  transform: [{ translateY: actionSheetTranslateY }],
                },
              ]}
            >
              {/* 分享按钮 - Image/File/Group 类型显示 */}
              {selectedItem &&
                (selectedItem.type === 'Image' ||
                  selectedItem.type === 'File' ||
                  selectedItem.type === 'Group') && (
                  <>
                    <TouchableOpacity
                      style={styles.actionSheetButton}
                      onPress={() => selectedItem && handleShare(selectedItem)}
                    >
                      <Text style={[styles.actionSheetButtonText, { color: theme.colors.text }]}>
                        分享
                      </Text>
                    </TouchableOpacity>
                    <View
                      style={[styles.actionSheetDivider, { backgroundColor: theme.colors.border }]}
                    />
                  </>
                )}

              {/* 复制按钮 - Text/Image 类型显示 */}
              {selectedItem && (selectedItem.type === 'Text' || selectedItem.type === 'Image') && (
                <>
                  <TouchableOpacity
                    style={styles.actionSheetButton}
                    onPress={() => selectedItem && handleCopyItem(selectedItem)}
                  >
                    <Text style={[styles.actionSheetButtonText, { color: theme.colors.text }]}>
                      复制
                    </Text>
                  </TouchableOpacity>
                  <View
                    style={[styles.actionSheetDivider, { backgroundColor: theme.colors.border }]}
                  />
                </>
              )}

              {/* 删除按钮 - 所有类型显示 */}
              <TouchableOpacity
                style={styles.actionSheetButton}
                onPress={() => selectedItem && handleDeleteFromMenu(selectedItem)}
              >
                <Text
                  style={[styles.actionSheetButtonText, { color: theme.colors.error || '#F44336' }]}
                >
                  删除
                </Text>
              </TouchableOpacity>
              <View style={[styles.actionSheetDivider, { backgroundColor: theme.colors.border }]} />

              {/* 取消按钮 */}
              <TouchableOpacity style={styles.actionSheetButton} onPress={() => closeActionSheet()}>
                <Text style={[styles.actionSheetButtonText, { color: theme.colors.textSecondary }]}>
                  取消
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </Pressable>
        </Modal>
      )}

      {/* 消息提示 */}
      <MessageToast message={message} onMessageShown={handleMessageShown} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
  },
  filterButtonActive: {
    // backgroundColor will be set by theme dynamically
  },
  filterButtonInactive: {
    // backgroundColor: transparent by default
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  filterButtonTextActive: {
    // color will be set by theme dynamically
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
  // Modal 样式
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  actionSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 20,
  },
  actionSheetButton: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  actionSheetButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  actionSheetDivider: {
    height: StyleSheet.hairlineWidth,
  },
});
