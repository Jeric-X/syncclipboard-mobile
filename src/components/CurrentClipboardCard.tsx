/**
 * Current Clipboard Card Component
 * 当前剪贴板内容卡片
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Clipboard,
  Share,
  Alert,
} from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { ClipboardContent } from '@/types/clipboard';

interface CurrentClipboardCardProps {
  clipboard: ClipboardContent | null;
  isRemote?: boolean;
  onUpload?: () => void;
  onDownload?: () => void;
}

export const CurrentClipboardCard: React.FC<CurrentClipboardCardProps> = ({
  clipboard,
  isRemote = false,
  onUpload,
  onDownload,
}) => {
  const { theme } = useTheme();

  // 复制到剪贴板
  const handleCopy = async () => {
    if (!clipboard || clipboard.type !== 'Text' || !clipboard.text) return;

    try {
      await Clipboard.setString(clipboard.text);
      // Toast提示已移除，可以通过父组件处理
    } catch (error) {
      console.error('[CurrentClipboardCard] Failed to copy:', error);
    }
  };

  // 分享内容
  const handleShare = async () => {
    if (!clipboard) return;

    try {
      if (clipboard.type === 'Text' && clipboard.text) {
        await Share.share({ message: clipboard.text });
      } else if (clipboard.type === 'Image' && clipboard.imageUri) {
        await Share.share({ url: clipboard.imageUri });
      } else if (clipboard.type === 'File' && clipboard.fileUri) {
        await Share.share({ url: clipboard.fileUri });
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

    // 图片类型：有 fileName 但没有 imageUri 或 fileData
    if (clipboard.type === 'Image') {
      return !!(clipboard.fileName && !clipboard.imageUri && !clipboard.fileData);
    }

    // 文件类型：有 fileName 但没有 fileUri 或 fileData
    if (clipboard.type === 'File') {
      return !!(clipboard.fileName && !clipboard.fileUri && !clipboard.fileData);
    }

    return false;
  };

  const showDownloadButton = isRemote && onDownload && needsFileDownload();

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
            <Text style={[styles.timestamp, { color: theme.colors.textSecondary }]}>刚刚</Text>
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
            <Text style={[styles.mediaLabel, { color: theme.colors.textSecondary }]}>
              {clipboard.fileName || '图片文件'}
            </Text>
            {clipboard.imageUri && (
              <Text style={[styles.mediaHint, { color: theme.colors.textTertiary }]}>
                包含图片数据
              </Text>
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
        {/* 内容操作按钮（复制或分享） */}
        {clipboard.type === 'Text' ? (
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: theme.colors.primary },
              !onUpload && !showDownloadButton && styles.actionButtonLast,
            ]}
            onPress={handleCopy}
          >
            <Text style={styles.actionButtonText}>复制</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: theme.colors.primary },
              !onUpload && !showDownloadButton && styles.actionButtonLast,
            ]}
            onPress={handleShare}
          >
            <Text style={styles.actionButtonText}>分享</Text>
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
            ]}
            onPress={onDownload}
          >
            <Text
              style={[
                styles.actionButtonText,
                styles.secondaryButtonText,
                { color: theme.colors.primary },
              ]}
            >
              下载
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Hash 信息 */}
      {clipboard.hash && (
        <View style={[styles.footer, { borderTopColor: theme.colors.divider }]}>
          <Text style={[styles.hashLabel, { color: theme.colors.textTertiary }]}>
            Hash: {clipboard.hash.substring(0, 16)}...
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
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  actionButtonText: {
    color: '#FFFFFF',
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
