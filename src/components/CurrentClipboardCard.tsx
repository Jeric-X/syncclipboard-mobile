/**
 * Current Clipboard Card Component
 * 当前剪贴板内容卡片
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Share, Image } from 'react-native';
import * as Sharing from 'expo-sharing';
import { useTheme } from '@/hooks/useTheme';
import { ClipboardContent } from '@/types/clipboard';
import { clipboardManager } from '@/services';

interface CurrentClipboardCardProps {
  clipboard: ClipboardContent | null;
  isRemote?: boolean;
  onUpload?: () => void;
  onDownload?: () => void;
  downloading?: boolean;
  onCopy?: (content: ClipboardContent) => Promise<void>;
}

export const CurrentClipboardCard: React.FC<CurrentClipboardCardProps> = ({
  clipboard,
  isRemote = false,
  onUpload,
  onDownload,
  downloading = false,
  onCopy,
}) => {
  const { theme } = useTheme();
  const [, setUpdateTrigger] = useState(0);

  // 监控 clipboard 变化并强制更新
  useEffect(() => {
    if (clipboard?.localClipboardHash) {
      console.log('[CurrentClipboardCard] ✓ Received clipboard update:', {
        type: clipboard.type,
        contentHash: clipboard.localClipboardHash.substring(0, 8),
        imageUri: clipboard.fileUri?.substring(clipboard.fileUri.lastIndexOf('/') + 1),
        timestamp: clipboard.timestamp,
      });
      setUpdateTrigger((prev) => prev + 1);
    }
  }, [clipboard?.localClipboardHash, clipboard?.fileUri]);

  // 每 30 秒更新一次时间显示
  useEffect(() => {
    const interval = setInterval(() => {
      setUpdateTrigger((prev) => prev + 1);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // 复制文本到剪贴板
  const handleCopy = async () => {
    if (!clipboard || clipboard.type !== 'Text' || !clipboard.text) return;

    try {
      if (onCopy) {
        await onCopy(clipboard);
      } else {
        await clipboardManager.setTextContent(clipboard.text);
      }
      // Toast提示已移除，可以通过父组件处理
    } catch (error) {
      console.error('[CurrentClipboardCard] Failed to copy:', error);
    }
  };

  // 复制图片到剪贴板
  const handleCopyImage = async () => {
    if (!clipboard || clipboard.type !== 'Image' || !clipboard.fileUri) return;

    try {
      if (onCopy) {
        await onCopy(clipboard);
      } else {
        await clipboardManager.setImageContent(clipboard.fileUri);
      }
      // Toast提示已移除，可以通过父组件处理
    } catch (error) {
      console.error('[CurrentClipboardCard] Failed to copy image:', error);
    }
  };

  // 分享内容
  const handleShare = async () => {
    if (!clipboard) return;

    try {
      if (clipboard.type === 'Text' && clipboard.text) {
        // 文本内容使用 React Native Share
        await Share.share({ message: clipboard.text });
      } else if (clipboard.type === 'Image' && clipboard.fileUri) {
        // 图片文件使用 expo-sharing 避免 file:// URI 问题
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(clipboard.fileUri, {
            mimeType: 'image/*',
            dialogTitle: clipboard.fileName || '分享图片',
          });
        }
      } else if (clipboard.type === 'File' && clipboard.fileUri) {
        // 其他文件使用 expo-sharing 避免 file:// URI 问题
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          await Sharing.shareAsync(clipboard.fileUri, {
            dialogTitle: clipboard.fileName || '分享文件',
          });
        }
      }
    } catch (error) {
      console.error('[CurrentClipboardCard] Failed to share:', error);
    }
  };

  if (!clipboard) {
    return (
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.emptyContent}>
          <Text style={[styles.emptyIcon, { color: theme.colors.textTertiary }]}>📋</Text>
          <Text style={[styles.emptyTitle, { color: theme.colors.textSecondary }]}>剪贴板为空</Text>
          <Text style={[styles.emptyDescription, { color: theme.colors.textTertiary }]}>
            复制内容后将在此显示
          </Text>
        </View>
      </View>
    );
  }

  const getTypeIcon = (type: string): string => {
    switch (type) {
      case 'Text':
        return '📝';
      case 'Image':
        return '🖼️';
      case 'File':
        return '📄';
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

    return new Date(timestamp).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 获取预览文本
  const getPreviewText = (): string => {
    if (clipboard.type === 'Text') {
      return clipboard.text || '';
    }
    if (clipboard.type === 'Image') {
      return clipboard.fileName || '图片';
    }
    if (clipboard.type === 'File') {
      return clipboard.fileName || '文件';
    }
    return '';
  };

  const previewText = getPreviewText();
  const isLongText = previewText.length > 200;

  // 判断是否需要下载额外文件
  const needsFileDownload = (): boolean => {
    if (!isRemote || !clipboard) return false;

    // 文本类型不需要额外文件
    if (clipboard.type === 'Text') return false;

    // 图片类型：有 fileName 但没有 fileUri 或 fileData
    if (clipboard.type === 'Image') {
      return !!(clipboard.fileName && !clipboard.fileUri && !clipboard.fileData);
    }

    // 文件类型：有 fileName 但没有 fileUri 或 fileData
    if (clipboard.type === 'File') {
      return !!(clipboard.fileName && !clipboard.fileUri && !clipboard.fileData);
    }

    return false;
  };

  const showDownloadButton = isRemote && onDownload && needsFileDownload();

  // 判断是否显示分享按钮（非Text类型且有文件URI）
  const canShowShareButton = (() => {
    if (!clipboard || clipboard.type === 'Text') return false;

    // 图片类型：需要有 fileUri
    if (clipboard.type === 'Image') return !!clipboard.fileUri;
    // 文件类型：需要有 fileUri
    if (clipboard.type === 'File') return !!clipboard.fileUri;

    return false;
  })();

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
      {/* 标题栏 */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.typeIcon}>{getTypeIcon(clipboard.type)}</Text>
          <View style={styles.headerInfo}>
            <Text style={[styles.typeLabel, { color: theme.colors.text }]}>
              {getTypeLabel(clipboard.type)}
            </Text>
            <Text style={[styles.timestamp, { color: theme.colors.textSecondary }]}>
              {clipboard.timestamp ? formatTime(clipboard.timestamp) : '刚刚'}
            </Text>
          </View>
        </View>

        {clipboard.fileSize !== undefined && (
          <Text style={[styles.sizeLabel, { color: theme.colors.textSecondary }]}>
            {formatSize(clipboard.fileSize)}
          </Text>
        )}
      </View>

      {/* 内容预览 */}
      <View style={styles.content}>
        {clipboard.type === 'Text' && (
          <Text
            style={[styles.previewText, { color: theme.colors.text }]}
            numberOfLines={isLongText ? 8 : undefined}
          >
            {previewText}
          </Text>
        )}

        {clipboard.type === 'Image' && (
          <View style={styles.mediaPreview}>
            {clipboard.fileUri ? (
              <>
                <Image
                  key={`image-${clipboard.localClipboardHash?.substring(0, 12)}-${clipboard.timestamp}`}
                  source={{
                    uri: `${clipboard.fileUri}?hash=${clipboard.localClipboardHash?.substring(0, 12) || clipboard.timestamp || Date.now()}`,
                    cache: 'reload',
                  }}
                  style={styles.imagePreview}
                  resizeMode="contain"
                  onError={(error) => {
                    console.error('[CurrentClipboardCard] Image load error:', error.nativeEvent);
                    console.error('[CurrentClipboardCard] File URI:', clipboard.fileUri);
                    console.error(
                      '[CurrentClipboardCard] Content Hash:',
                      clipboard.localClipboardHash?.substring(0, 8)
                    );
                  }}
                  onLoad={() => {
                    console.log(
                      '[CurrentClipboardCard] Image loaded successfully:',
                      clipboard.fileUri,
                      'contentHash:',
                      clipboard.localClipboardHash?.substring(0, 8)
                    );
                  }}
                />
              </>
            ) : (
              <View>
                <Text style={[styles.mediaLabel, { color: theme.colors.textSecondary }]}>
                  {clipboard.fileName || '图片文件'}
                </Text>
                <Text style={[styles.mediaHint, { color: theme.colors.textTertiary }]}>
                  等待下载...
                </Text>
              </View>
            )}
          </View>
        )}

        {clipboard.type === 'File' && (
          <View style={styles.mediaPreview}>
            <Text style={[styles.mediaLabel, { color: theme.colors.textSecondary }]}>
              {clipboard.fileName || '文件'}
            </Text>
            {clipboard.fileUri && (
              <Text style={[styles.mediaHint, { color: theme.colors.textTertiary }]}>
                包含文件数据
              </Text>
            )}
          </View>
        )}
      </View>

      {/* 按钮区域 */}
      <View style={styles.actionButtons}>
        {/* Text类型：复制按钮 */}
        {clipboard.type === 'Text' && (
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: theme.colors.primary },
              !onUpload && !showDownloadButton && styles.actionButtonLast,
            ]}
            onPress={handleCopy}
          >
            <Text style={[styles.actionButtonText, { color: theme.colors.white }]}>复制</Text>
          </TouchableOpacity>
        )}

        {/* Image类型：复制按钮 */}
        {clipboard.type === 'Image' && clipboard.fileUri && (
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: theme.colors.primary },
              !canShowShareButton && !onUpload && !showDownloadButton && styles.actionButtonLast,
            ]}
            onPress={handleCopyImage}
          >
            <Text style={[styles.actionButtonText, { color: theme.colors.white }]}>复制</Text>
          </TouchableOpacity>
        )}

        {/* 非Text类型且已下载：分享按钮 */}
        {canShowShareButton && (
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: theme.colors.primary },
              !onUpload && !showDownloadButton && styles.actionButtonLast,
            ]}
            onPress={handleShare}
          >
            <Text style={[styles.actionButtonText, { color: theme.colors.white }]}>分享</Text>
          </TouchableOpacity>
        )}

        {/* 同步操作按钮 */}
        {!isRemote && onUpload && (
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.secondaryButton,
              styles.actionButtonLast,
              { borderColor: theme.colors.primary },
            ]}
            onPress={onUpload}
          >
            <Text
              style={[
                styles.actionButtonText,
                styles.secondaryButtonText,
                { color: theme.colors.primary },
              ]}
            >
              上传
            </Text>
          </TouchableOpacity>
        )}

        {showDownloadButton && (
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.secondaryButton,
              styles.actionButtonLast,
              { borderColor: theme.colors.primary },
              downloading && styles.buttonDisabled,
            ]}
            onPress={onDownload}
            disabled={downloading}
          >
            <Text
              style={[
                styles.actionButtonText,
                styles.secondaryButtonText,
                { color: theme.colors.primary },
              ]}
            >
              {downloading ? '下载中...' : '下载'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Hash 信息 */}
      {clipboard.profileHash && (
        <View style={[styles.footer, { borderTopColor: theme.colors.divider }]}>
          <Text style={[styles.hashLabel, { color: theme.colors.textTertiary }]}>
            Hash: {clipboard.profileHash.substring(0, 16)}...
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  emptyContent: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  emptyDescription: {
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  typeIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  headerInfo: {
    flex: 1,
  },
  typeLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  timestamp: {
    fontSize: 13,
  },
  sizeLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  content: {
    marginBottom: 16,
  },
  actionButtons: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionButtonLast: {
    marginRight: 0,
  },
  secondaryButton: {
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButtonText: {
    fontWeight: '500',
  },
  previewText: {
    fontSize: 15,
    lineHeight: 22,
  },
  mediaPreview: {
    paddingVertical: 8,
  },
  imagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 8,
  },
  mediaLabel: {
    fontSize: 15,
    marginBottom: 4,
  },
  mediaHint: {
    fontSize: 13,
  },
  footer: {
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hashLabel: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
