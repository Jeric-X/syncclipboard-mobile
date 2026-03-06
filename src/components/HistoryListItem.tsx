/**
 * History List Item Component
 * 历史记录列表项组件
 */

import React, { useState, useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableHighlight, Image, TouchableOpacity } from 'react-native';
import { Copy, Share, Trash2, ExternalLink } from 'react-native-feather';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, {
  useAnimatedReaction,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '@/hooks/useTheme';
import { ClipboardItem } from '@/types/clipboard';
import { useSettingsStore } from '@/stores';

export interface HistoryListItemHandle {
  startDelete: () => void;
}

interface HistoryListItemProps {
  item: ClipboardItem;
  onCopy: (item: ClipboardItem) => void;
  onShare: (item: ClipboardItem) => void;
  onOpen?: (item: ClipboardItem) => void;
  onLongPress: (item: ClipboardItem) => void;
  onDelete?: (item: ClipboardItem) => void;
  showFullImage?: boolean;
}

export const HistoryListItem = forwardRef<HistoryListItemHandle, HistoryListItemProps>(
  ({ item, onCopy, onShare, onOpen, onLongPress, onDelete, showFullImage = false }, ref) => {
    const { theme } = useTheme();
    const { config } = useSettingsStore();
    const isDebugMode = config?.debugMode ?? false;
    const [imageDimensions, setImageDimensions] = useState<{
      width: number;
      height: number;
    } | null>(null);
    const [containerWidth, setContainerWidth] = useState<number>(0);
    const swipeableRef = useRef<React.ComponentRef<typeof Swipeable>>(null);
    const shouldAutoDeleteRef = useRef<boolean>(false);
    const [swipeDeleteHint, setSwipeDeleteHint] = useState<'default' | 'continue' | 'release'>(
      'default'
    );
    const isDeletingRef = useRef(false);
    const lastHintRef = useRef<'default' | 'continue' | 'release'>('default');
    const deleteAnimProgress = useSharedValue(0);

    // 当item改变时重置所有动画和状态（处理FlashList容器复用的情况）
    useEffect(() => {
      // 重置删除动画进度
      deleteAnimProgress.value = 0;
      // 重置删除标志
      isDeletingRef.current = false;
      shouldAutoDeleteRef.current = false;
      lastHintRef.current = 'default';
      setSwipeDeleteHint('default');
      // 关闭Swipeable（如果打开）
      if (swipeableRef.current) {
        swipeableRef.current.close();
      }
    }, [item.profileHash, deleteAnimProgress]);

    // 暴露 imperative handle
    useImperativeHandle(
      ref,
      () => ({
        startDelete: () => {
          if (isDeletingRef.current) return;
          isDeletingRef.current = true;
          deleteAnimProgress.value = withTiming(1, { duration: 400 }, (finished) => {
            if (finished && onDelete) {
              scheduleOnRN(onDelete, item);
            }
          });
        },
      }),
      [item, onDelete]
    );

    // 处理自动删除的函数
    const handleAutoDelete = () => {
      if (onDelete && shouldAutoDeleteRef.current && !isDeletingRef.current) {
        isDeletingRef.current = true;
        // 触发滑出动画
        deleteAnimProgress.value = withTiming(1, { duration: 400 }, (finished) => {
          if (finished) {
            scheduleOnRN(onDelete, item);
          }
        });
      }
    };

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

    const formatSize = (bytes?: number, type?: string): string => {
      if (!bytes) return '';
      // Text 类型显示字符数（添加千分位逗号）
      if (type === 'Text') {
        return bytes.toLocaleString('zh-CN');
      }
      // 其他类型显示文件大小
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

    // 卡片滑出动画样式
    const cardDeleteAnimStyle = useAnimatedStyle(() => {
      const translateX = interpolate(
        deleteAnimProgress.value,
        [0, 1],
        [0, -500],
        Extrapolation.CLAMP
      );
      const opacity = interpolate(deleteAnimProgress.value, [0, 1], [1, 0], Extrapolation.CLAMP);
      return {
        transform: [{ translateX }],
        opacity,
        overflow: 'hidden',
      };
    });

    const previewText = getPreviewText();

    const updateSwipeDeleteState = (
      hint: 'default' | 'continue' | 'release',
      shouldAutoDelete: boolean
    ) => {
      // 只在状态真正变化时更新，避免频繁重渲染导致闪烁
      if (lastHintRef.current !== hint) {
        lastHintRef.current = hint;
        setSwipeDeleteHint(hint);
      }
      shouldAutoDeleteRef.current = shouldAutoDelete;
    };

    // 渲染右侧滑动操作（删除按钮）
    const renderRightActions = (progress: SharedValue<number>) => {
      if (!onDelete) return null;
      return (
        <DeleteActionComponent
          progress={progress}
          onDelete={onDelete}
          swipeDeleteHint={swipeDeleteHint}
          theme={theme}
          item={item}
          deleteAnimProgress={deleteAnimProgress}
        />
      );
    };

    // 删除按钮内部组件
    const DeleteActionComponent = React.memo(
      ({
        progress,
        onDelete,
        swipeDeleteHint,
        theme,
        item,
        deleteAnimProgress,
      }: {
        progress: SharedValue<number>;
        onDelete: (item: ClipboardItem) => void;
        swipeDeleteHint: 'default' | 'continue' | 'release';
        theme: ReturnType<typeof useTheme>['theme'];
        item: ClipboardItem;
        deleteAnimProgress: SharedValue<number>;
      }) => {
        // 删除按钮直接隐去：删除动画开始时立即隐藏
        const deleteButtonHideStyle = useAnimatedStyle(() => {
          const opacity = deleteAnimProgress.value > 0 ? 0 : 1;
          return {
            opacity,
          };
        });
        // 继续左滑时切换到“松手删除”，并标记松手后自动删除
        useAnimatedReaction(
          () => progress.value,
          (progressVal, previousVal) => {
            const continueThreshold = 1.02;
            const releaseThreshold = 1.55;
            // 添加回退缓冲，避免边界抖动
            const continueBufferBack = 0.95;
            const releaseBufferBack = 1.4;

            let hint: 'default' | 'continue' | 'release' = 'default';

            // 向前滑动使用正常阈值，向后滑动使用缓冲阈值，形成滞后效应
            if (progressVal >= releaseThreshold) {
              hint = 'release';
            } else if (progressVal >= continueThreshold) {
              hint = 'continue';
            } else if (
              previousVal !== null &&
              previousVal >= releaseThreshold &&
              progressVal >= releaseBufferBack
            ) {
              hint = 'release';
            } else if (
              previousVal !== null &&
              previousVal >= continueThreshold &&
              progressVal >= continueBufferBack
            ) {
              hint = 'continue';
            }

            const shouldAutoDelete = progressVal >= releaseThreshold;
            scheduleOnRN(updateSwipeDeleteState, hint, shouldAutoDelete);
          }
        );

        return (
          <Reanimated.View style={[styles.swipeActionsContainer, deleteButtonHideStyle]}>
            <View
              style={[styles.deleteButton, { backgroundColor: theme.colors.error || '#F44336' }]}
            >
              <TouchableOpacity
                style={styles.deleteButtonContent}
                onPress={() => {
                  // 触发滑出动画
                  deleteAnimProgress.value = withTiming(1, { duration: 400 }, (finished) => {
                    if (finished) {
                      scheduleOnRN(onDelete, item);
                    }
                  });
                }}
              >
                <Trash2 color={theme.colors.white} width={20} height={20} />
                <Text style={[styles.deleteButtonText, { color: theme.colors.white }]}>
                  {swipeDeleteHint === 'release'
                    ? '松手删除'
                    : swipeDeleteHint === 'continue'
                    ? '继续滑动删除'
                    : '删除'}
                </Text>
              </TouchableOpacity>
            </View>
          </Reanimated.View>
        );
      }
    );

    // 完全滑开时检查是否应该自动删除
    const handleSwipeableWillOpen = () => {
      if (shouldAutoDeleteRef.current && onDelete) {
        handleAutoDelete();
      }
    };

    // 打开后（用户松手后）再次检查是否需要删除，保证“松手删除”可触发
    const handleSwipeableOpen = () => {
      if (shouldAutoDeleteRef.current && onDelete) {
        handleAutoDelete();
      }
    };

    // 关闭时重置状态
    const handleSwipeableClose = () => {
      shouldAutoDeleteRef.current = false;
      lastHintRef.current = 'default';
      setSwipeDeleteHint('default');
      isDeletingRef.current = false;
    };

    return (
      <Reanimated.View style={[cardDeleteAnimStyle]} renderToHardwareTextureAndroid={true}>
        <Swipeable
          ref={swipeableRef}
          renderRightActions={renderRightActions}
          friction={1.2}
          rightThreshold={50}
          overshootRight={true}
          onSwipeableWillOpen={handleSwipeableWillOpen}
          onSwipeableOpen={handleSwipeableOpen}
          onSwipeableClose={handleSwipeableClose}
          enabled={!isDeletingRef.current}
          childrenContainerStyle={styles.swipeableChildrenContainer}
          /*
        新的交互流程：
        1. 用户左滑，在80px时显示删除按钮
        2. 如果松手，界面保持在删除按钮状态
        3. 用户可以点击删除按钮删除
        4. 或用户继续左滑，距离超过150px或快速滑动会自动删除
      */
        >
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
                  style={[
                    styles.typeLabel,
                    styles.typeLabelSpacing,
                    { color: theme.colors.primary },
                  ]}
                >
                  {getTypeLabel(item.type)}
                </Text>

                {/* 时间戳 */}
                <Text
                  style={[
                    styles.timestamp,
                    styles.timestampAlign,
                    { color: theme.colors.textSecondary },
                  ]}
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
                        imageDimensions && containerWidth > 0
                          ? {
                              height:
                                (containerWidth / imageDimensions.width) * imageDimensions.height,
                            }
                          : styles.imagePreviewLimited,
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
                      {formatSize(item.size, item.type)}
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
                      {item.fileUri && onOpen && (
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => onOpen(item)}
                          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                        >
                          <View style={{ transform: [{ scale: 0.6 }] }}>
                            <ExternalLink color={theme.colors.primary} />
                          </View>
                        </TouchableOpacity>
                      )}
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
                    <>
                      {item.fileUri && onOpen && (
                        <TouchableOpacity
                          style={styles.actionButton}
                          onPress={() => onOpen(item)}
                          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                        >
                          <View style={{ transform: [{ scale: 0.6 }] }}>
                            <ExternalLink color={theme.colors.primary} />
                          </View>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => onShare(item)}
                        hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                      >
                        <View style={{ transform: [{ scale: 0.6 }] }}>
                          <Share color={theme.colors.primary} />
                        </View>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>

              {/* 调试信息：profileHash */}
              {isDebugMode && item.profileHash && (
                <View style={styles.debugRow}>
                  <Text style={[styles.debugLabel, { color: theme.colors.textTertiary }]}>
                    Hash:
                  </Text>
                  <Text style={[styles.debugValue, { color: theme.colors.textSecondary }]}>
                    {item.profileHash.substring(0, 16)}...
                  </Text>
                </View>
              )}

              {/* 调试信息：fileUrl */}
              {isDebugMode && item.fileUri && (
                <View style={styles.debugRow}>
                  <Text style={[styles.debugLabel, { color: theme.colors.textTertiary }]}>
                    URL:
                  </Text>
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
        </Swipeable>
      </Reanimated.View>
    );
  }
);

HistoryListItem.displayName = 'HistoryListItem';

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
  swipeActionsContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginVertical: 4,
    marginRight: 16,
  },
  swipeableChildrenContainer: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  deleteButton: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 100,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  deleteButtonContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  deleteButtonText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});
