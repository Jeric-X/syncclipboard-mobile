/**
 * History List Item Component
 * 历史记录列表项组件
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableHighlight, Image, TouchableOpacity } from 'react-native';
import { Copy, Share } from 'react-native-feather';
import { useTheme } from '@/hooks/useTheme';
import { ClipboardItem } from '@/types/clipboard';
import { useSettingsStore } from '@/stores';

interface HistoryListItemProps {
  item: ClipboardItem;
  onCopy: (item: ClipboardItem) => void;
  onShare: (item: ClipboardItem) => void;
  onLongPress: (item: ClipboardItem) => void;
  showFullImage?: boolean;
}

export const HistoryListItem: React.FC<HistoryListItemProps> = ({
  item,
  onCopy,
  onShare,
  onLongPress,
  showFullImage = false,
}) => {
  const { theme } = useTheme();
  const { config } = useSettingsStore();
  const isDebugMode = config?.debugMode ?? false;
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(
    null
  );
  const [containerWidth, setContainerWidth] = useState<number>(0);

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

  return (
    <TouchableHighlight
      onLongPress={() => onLongPress(item)}
      underlayColor={theme.colors.border}
      style={styles.touchable}
    >
      <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
        {/* 顶部内容区 */}
        <View style={styles.topContent}>
          {/* 左侧图标 */}
          <View style={styles.iconContainer}>
            <Text style={styles.typeIcon}>{getTypeIcon(item.type)}</Text>
          </View>

          {/* 类型标签和时间 */}
          <Text
            style={[styles.typeLabel, styles.typeLabelSpacing, { color: theme.colors.primary }]}
          >
            {getTypeLabel(item.type)}
          </Text>

          {/* 时间戳 */}
          <Text
            style={[styles.timestamp, styles.timestampAlign, { color: theme.colors.textSecondary }]}
          >
            {formatTime(item.timestamp)}
          </Text>
        </View>

        {/* 预览文本 - 另起一行（非图片类型显示） */}
        {item.type !== 'Image' && (
          <Text
            style={[styles.previewText, { color: theme.colors.text }]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {previewText}
          </Text>
        )}

        {/* 图片预览 - 占据整个宽度 */}
        {item.type === 'Image' && item.fileUri && (
          <View
            style={styles.imagePreviewContainer}
            onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
          >
            {showFullImage ? (
              <Image
                source={{ uri: item.fileUri }}
                style={[
                  styles.imagePreview,
                  imageDimensions &&
                    containerWidth > 0 && {
                      height: (containerWidth / imageDimensions.width) * imageDimensions.height,
                    },
                ]}
                resizeMode="cover"
                onLoad={(e) => {
                  const { width, height } = e.nativeEvent.source;
                  setImageDimensions({ width, height });
                }}
              />
            ) : (
              <Image
                source={{ uri: item.fileUri }}
                style={[styles.imagePreview, styles.imagePreviewLimited]}
                resizeMode="cover"
              />
            )}
          </View>
        )}

        {/* 底部信息区 */}
        <View style={styles.bottomContent}>
          <View style={styles.metaInfo}>
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
          <View style={styles.actionsRow}>
            {item.type === 'Text' && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => onCopy(item)}
                hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
              >
                <View style={{ transform: [{ scale: 0.6 }] }}>
                  <Copy color={theme.colors.primary} />
                </View>
              </TouchableOpacity>
            )}
            {item.type === 'Image' && (
              <>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => onShare(item)}
                  hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                >
                  <View style={{ transform: [{ scale: 0.6 }] }}>
                    <Share color={theme.colors.primary} />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => onCopy(item)}
                  hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                >
                  <View style={{ transform: [{ scale: 0.6 }] }}>
                    <Copy color={theme.colors.primary} />
                  </View>
                </TouchableOpacity>
              </>
            )}
            {(item.type === 'File' || item.type === 'Group') && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => onShare(item)}
                hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
              >
                <View style={{ transform: [{ scale: 0.6 }] }}>
                  <Share color={theme.colors.primary} />
                </View>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* 调试信息：profileHash */}
        {isDebugMode && item.profileHash && (
          <View style={styles.debugRow}>
            <Text style={[styles.debugLabel, { color: theme.colors.textTertiary }]}>Hash:</Text>
            <Text style={[styles.debugValue, { color: theme.colors.textSecondary }]}>
              {item.profileHash.substring(0, 16)}...
            </Text>
          </View>
        )}

        {/* 调试信息：fileUrl */}
        {isDebugMode && item.fileUri && (
          <View style={styles.debugRow}>
            <Text style={[styles.debugLabel, { color: theme.colors.textTertiary }]}>URL:</Text>
            <Text
              style={[
                styles.debugValue,
                styles.debugValueFlex,
                { color: theme.colors.textSecondary },
              ]}
            >
              {item.fileUri}
            </Text>
          </View>
        )}
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
    flexDirection: 'column',
    padding: 12,
    borderRadius: 12,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  topContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  bottomContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  iconContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    overflow: 'hidden',
  },
  typeIcon: {
    fontSize: 13,
  },
  imagePreviewContainer: {
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 8,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  imagePreview: {
    width: '100%',
  },
  imagePreviewLimited: {
    height: 180,
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
  typeLabelSpacing: {
    marginLeft: 8,
    marginRight: 8,
  },
  timestamp: {
    fontSize: 12,
  },
  timestampAlign: {
    flex: 1,
    textAlign: 'right',
  },
  previewText: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 4,
  },

  metaInfo: {
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
  actionsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  actionButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  actionButtonIcon: {
    fontSize: 14,
  },
  debugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  debugLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  debugValue: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  debugValueFlex: {
    flex: 1,
  },
});
