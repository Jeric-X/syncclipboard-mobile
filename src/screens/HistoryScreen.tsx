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
} from 'react-native';
import { MoreVertical, Check } from 'react-native-feather';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '@/hooks/useTheme';
import { useHistoryStore } from '@/stores/historyStore';
import { useHistoryDisplaySettings } from '@/hooks/useHistoryDisplaySettings';
import { ClipboardItem, ClipboardContent } from '@/types/clipboard';
import { HistoryListItem } from '@/components/HistoryListItem';
import { MessageToast } from '@/components/MessageToast';
import { copyToLocalClipboard } from '@/utils/clipboard';
import { useMessageToast } from '@/hooks/useMessageToast';

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
    deleteItem,
    clearHistory,
    currentPage,
    lastAddedTimestamp,
  } = useHistoryStore();

  const { showFullImage, setShowFullImage } = useHistoryDisplaySettings();

  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [selectedItem, setSelectedItem] = useState<ClipboardItem | null>(null);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const { message, showMessage, handleMessageShown } = useMessageToast();

  const listRef = useRef<FlashListRef<ClipboardItem>>(null);
  const isScrolledRef = useRef(false);
  const menuButtonRef = useRef<React.ComponentRef<typeof TouchableOpacity>>(null);
  const [menuTopOffset, setMenuTopOffset] = useState(60);

  // 设置自定义 header
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          ref={menuButtonRef}
          onPress={handleOpenMenu}
          style={styles.headerButton}
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
        >
          <MoreVertical color={theme.colors.text} width={20} height={20} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, theme.colors.text]);

  // 打开菜单
  const handleOpenMenu = useCallback(() => {
    if (menuButtonRef.current) {
      menuButtonRef.current.measure(
        (_x: number, _y: number, _w: number, h: number, _pageX: number, pageY: number) => {
          setMenuTopOffset(pageY + h + 4);
          setShowMenu(true);
        }
      );
    } else {
      setShowMenu(true);
    }
  }, []);

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
      setShowActionSheet(false);
    },
    [showMessage, copyItemWithSync]
  );

  // 删除项目（直接删除，不弹确认框）
  const handleDeleteItem = useCallback(
    async (item: ClipboardItem) => {
      try {
        await deleteItem(item.profileHash);
        setShowActionSheet(false);
        showMessage('已删除', 'success');
      } catch (error) {
        console.error('[HistoryScreen] Failed to delete:', error);
        showMessage('删除失败', 'error');
      }
    },
    [deleteItem, showMessage]
  );

  // 长按列表项 - 显示操作菜单
  const handleItemLongPress = useCallback(
    (item: ClipboardItem) => {
      setSelectedItem(item);

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ['取消', '复制', '删除'],
            destructiveButtonIndex: 2,
            cancelButtonIndex: 0,
          },
          (buttonIndex) => {
            if (buttonIndex === 1) {
              handleCopyItem(item);
            } else if (buttonIndex === 2) {
              handleDeleteItem(item);
            }
          }
        );
      } else {
        setShowActionSheet(true);
      }
    },
    [handleCopyItem, handleDeleteItem]
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

  // 切换完整图片显示
  const handleToggleFullImage = useCallback(async () => {
    await setShowFullImage(!showFullImage);
    setShowMenu(false);
  }, [showFullImage, setShowFullImage]);

  // 渲染列表项
  const renderItem = useCallback(
    ({ item }: { item: ClipboardItem }) => (
      <HistoryListItem
        item={item}
        onCopy={handleItemPress}
        onShare={handleShare}
        onLongPress={handleItemLongPress}
        onDelete={handleDeleteItem}
        showFullImage={showFullImage}
      />
    ),
    [handleItemPress, handleShare, handleItemLongPress, handleDeleteItem, showFullImage]
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
        <TouchableOpacity onPress={handleClearAll} style={styles.clearButton}>
          <Text style={[styles.clearButtonText, { color: theme.colors.error || '#F44336' }]}>
            清空
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

      {/* 悬浮菜单 */}
      {showMenu && (
        <Modal
          visible={showMenu}
          transparent
          animationType="none"
          onRequestClose={() => setShowMenu(false)}
        >
          <Pressable style={styles.fullScreenOverlay} onPress={() => setShowMenu(false)}>
            <View
              style={[
                styles.floatingMenu,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  top: menuTopOffset,
                },
              ]}
            >
              <TouchableOpacity style={styles.menuItem} onPress={handleToggleFullImage}>
                <Text style={[styles.menuItemText, { color: theme.colors.text }]}>
                  展示完整图片
                </Text>
                {showFullImage && <Check color={theme.colors.primary} width={18} height={18} />}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>
      )}

      {/* Android 操作菜单 Modal */}
      {Platform.OS === 'android' && (
        <Modal
          visible={showActionSheet}
          transparent
          animationType="fade"
          onRequestClose={() => setShowActionSheet(false)}
        >
          <Pressable
            style={[styles.modalOverlay, { backgroundColor: theme.colors.backdrop }]}
            onPress={() => setShowActionSheet(false)}
          >
            <View style={[styles.actionSheet, { backgroundColor: theme.colors.surface }]}>
              <TouchableOpacity
                style={styles.actionSheetButton}
                onPress={() => selectedItem && handleCopyItem(selectedItem)}
              >
                <Text style={[styles.actionSheetButtonText, { color: theme.colors.text }]}>
                  复制
                </Text>
              </TouchableOpacity>
              <View style={[styles.actionSheetDivider, { backgroundColor: theme.colors.border }]} />
              <TouchableOpacity
                style={styles.actionSheetButton}
                onPress={() => selectedItem && handleDeleteItem(selectedItem)}
              >
                <Text
                  style={[styles.actionSheetButtonText, { color: theme.colors.error || '#F44336' }]}
                >
                  删除
                </Text>
              </TouchableOpacity>
              <View style={[styles.actionSheetDivider, { backgroundColor: theme.colors.border }]} />
              <TouchableOpacity
                style={styles.actionSheetButton}
                onPress={() => setShowActionSheet(false)}
              >
                <Text style={[styles.actionSheetButtonText, { color: theme.colors.textSecondary }]}>
                  取消
                </Text>
              </TouchableOpacity>
            </View>
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
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  clearButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  headerButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
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
  fullScreenOverlay: {
    flex: 1,
  },
  floatingMenu: {
    position: 'absolute',
    right: 10,
    borderRadius: 8,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
    minWidth: 180,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: '500',
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
