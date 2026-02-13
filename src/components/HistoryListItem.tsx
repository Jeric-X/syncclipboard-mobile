/**
 * History List Item Component
 * 历史记录列表项组件
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TouchableHighlight } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { ClipboardItem } from '@/types/clipboard';

interface HistoryListItemProps {
  item: ClipboardItem;
  onPress: (item: ClipboardItem) => void;
  onLongPress: (item: ClipboardItem) => void;
}

export const HistoryListItem: React.FC<HistoryListItemProps> = ({ item, onPress, onLongPress }) => {
  const { theme } = useTheme();

  const getTypeIcon = (type: string): string => {
    switch (type) {
      case 'Text':
        return '📝';
      case 'Image':
        return '🖼️';
      case 'File':
        return '📄';
      case 'Group':
        return '📦';
      default:
        return '📋';
    }
  };

  const getTypeLabel = (type: string): string => {
    switch (type) {
      case 'Text':
        return '文本';
      case 'Image':
        return '图片';
      case 'File':
        return '文件';
      case 'Group':
        return '文件组';
      default:
        return '未知';
    }
  };

  const formatSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getPreviewText = (): string => {
    if (item.type === 'Text') {
      return item.text || '';
    }
    if (item.type === 'Image') {
      return item.dataName || '图片';
    }
    if (item.type === 'File') {
      return item.dataName || '文件';
    }
    if (item.type === 'Group') {
      return item.dataName || '文件组';
    }
    return '';
  };

  const previewText = getPreviewText();
  const isLongText = previewText.length > 100;

  return (
    <TouchableHighlight
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      underlayColor={theme.colors.border}
      style={styles.touchable}
    >
      <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
        {/* 左侧图标 */}
        <View style={styles.iconContainer}>
          <Text style={styles.typeIcon}>{getTypeIcon(item.type)}</Text>
        </View>

        {/* 中间内容区 */}
        <View style={styles.contentContainer}>
          {/* 第一行：类型标签 + 时间 */}
          <View style={styles.headerRow}>
            <Text style={[styles.typeLabel, { color: theme.colors.primary }]}>
              {getTypeLabel(item.type)}
            </Text>
            <Text style={[styles.timestamp, { color: theme.colors.textSecondary }]}>
              {formatTime(item.timestamp)}
            </Text>
          </View>

          {/* 第二行：预览文本 */}
          <Text
            style={[styles.previewText, { color: theme.colors.text }]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {previewText}
          </Text>

          {/* 第三行：附加信息 */}
          <View style={styles.metaRow}>
            {item.size !== undefined && (
              <Text style={[styles.metaText, { color: theme.colors.textTertiary }]}>
                {formatSize(item.size)}
              </Text>
            )}
            {item.synced !== undefined && (
              <View style={styles.syncBadge}>
                <Text
                  style={[
                    styles.syncBadgeText,
                    {
                      color: item.synced
                        ? theme.colors.success || '#4CAF50'
                        : theme.colors.textTertiary,
                    },
                  ]}
                >
                  {item.synced ? '✓ 已同步' : '未同步'}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* 右侧箭头 */}
        <View style={styles.arrowContainer}>
          <Text style={[styles.arrow, { color: theme.colors.textTertiary }]}>›</Text>
        </View>
      </View>
    </TouchableHighlight>
  );
};

const styles = StyleSheet.create({
  touchable: {
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 12,
  },
  container: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  iconContainer: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeIcon: {
    fontSize: 24,
  },
  contentContainer: {
    flex: 1,
    marginLeft: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  typeLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  timestamp: {
    fontSize: 12,
  },
  previewText: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    fontSize: 12,
  },
  syncBadge: {
    marginLeft: 4,
  },
  syncBadgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  arrowContainer: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    fontSize: 24,
    fontWeight: '300',
  },
});
