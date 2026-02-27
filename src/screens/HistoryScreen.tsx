/**
 * History Screen
 * 历史记录页面 - 显示剪贴板历史记录
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useTheme } from '@/hooks/useTheme';
import { useHistoryStore } from '@/stores/historyStore';
import { ClipboardItem } from '@/types/clipboard';
import { HistoryListItem } from '@/components/HistoryListItem';
import { MessageToast } from '@/components/MessageToast';
import { clipboardManager } from '@/services';
import { useMessageToast } from '@/hooks/useMessageToast';

type FilterType = 'all' | 'Text' | 'Image' | 'File';

export function HistoryScreen() {
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
  } = useHistoryStore();

  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [selectedItem, setSelectedItem] = useState<ClipboardItem | null>(null);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const { message, showMessage, handleMessageShown } = useMessageToast();

  // 搜索防抖（含初始加载）
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchText) {
        searchItems({ keyword: searchText });
      } else {
        loadItems();
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchText, searchItems, loadItems]);

  // 过滤数据
  const filteredItems = useMemo(() => {
    if (filterType === 'all') {
      return items;
    }
    return items.filter((item) => item.type === filterType);
  }, [items, filterType]);

  // 点击列表项 - 复制到剪贴板
  const handleItemPress = useCallback(
    async (item: ClipboardItem) => {
      try {
        if (item.type === 'Text' && item.text) {
          await clipboardManager.setClipboardContent({
            type: 'Text',
            text: item.text,
            profileHash: item.profileHash,
          });
          showMessage('已复制到剪贴板', 'success');
        } else {
          showMessage('暂不支持非文本类型的快速复制', 'info');
        }
      } catch (error) {
        console.error('[HistoryScreen] Failed to copy:', error);
        showMessage('复制失败', 'error');
      }
    },
    [showMessage]
  );

  // 长按列表项 - 显示操作菜单
  const handleItemLongPress = useCallback((item: ClipboardItem) => {
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
  }, []);

  // 复制项目
  const handleCopyItem = useCallback(
    async (item: ClipboardItem) => {
      try {
        if (item.type === 'Text' && item.text) {
          await clipboardManager.setClipboardContent({
            type: 'Text',
            text: item.text,
            profileHash: item.profileHash,
          });
          showMessage('已复制到剪贴板', 'success');
        }
      } catch (error) {
        console.error('[HistoryScreen] Failed to copy:', error);
        showMessage('复制失败', 'error');
      }
      setShowActionSheet(false);
    },
    [showMessage]
  );

  // 删除项目
  const handleDeleteItem = useCallback(
    (item: ClipboardItem) => {
      Alert.alert('确认删除', '确定要删除这条历史记录吗？', [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteItem(item.profileHash);
              setShowActionSheet(false);
            } catch (error) {
              console.error('[HistoryScreen] Failed to delete:', error);
              Alert.alert('错误', '删除失败');
            }
          },
        },
      ]);
    },
    [deleteItem]
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

  // 渲染列表项
  const renderItem = useCallback(
    ({ item }: { item: ClipboardItem }) => (
      <HistoryListItem item={item} onPress={handleItemPress} onLongPress={handleItemLongPress} />
    ),
    [handleItemPress, handleItemLongPress]
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
        data={filteredItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.profileHash}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={renderEmptyComponent}
        contentContainerStyle={styles.listContent}
      />

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
  // Android Modal 样式
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
