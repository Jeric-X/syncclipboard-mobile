/**
 * Current Clipboard Card Component
 * 当前剪贴板内容卡片
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Share,
  Image,
  Linking,
} from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { ClipboardContent } from '@/types/clipboard';
import { useSettingsStore } from '@/stores';
import { useMessageStore } from '@/stores/messageStore';
import { openFile, shareFile, saveToGallery } from '@/utils/fileActions';
import { formatFileSize, formatSizeWithType, isTextInvalid } from '@/utils';
import { saveContentDataToDirectory } from '@/utils/clipboard/clipboardContentUtils';
import * as FileSystem from 'expo-file-system/legacy';
import type { ProgressInfo } from 'native-util';

interface DownloadProgress {
  progress: number;
  bytesTransferred: number;
  totalBytes: number;
}

interface CurrentClipboardCardProps {
  clipboard: ClipboardContent | null;
  isRemote?: boolean;
  onAction?: () => void;
  acting?: boolean;
  actionProgress?: DownloadProgress | null;
  onCancelAction?: () => void;
  onCopy: (content: ClipboardContent) => Promise<void>;
  onWordPick?: (text: string) => void;
}

export const CurrentClipboardCard: React.FC<CurrentClipboardCardProps> = ({
  clipboard,
  isRemote = false,
  onAction,
  acting = false,
  actionProgress,
  onCancelAction,
  onCopy,
  onWordPick,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { config } = useSettingsStore();
  const { showMessage } = useMessageStore();
  const isDebugMode = config?.debugMode ?? false;
  const [, setUpdateTrigger] = useState(0);

  // 保存操作状态
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<ProgressInfo | null>(null);
  const saveAbortControllerRef = useRef<AbortController | null>(null);

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

  // 检测文本中的 URL
  const detectedUrl = useMemo(() => {
    if (!clipboard || clipboard.type !== 'Text' || !clipboard.text) return null;
    const urlRegex = /https?:\/\/[^\s<>"'()\]\[{}]+/i;
    const match = clipboard.text.match(urlRegex);
    return match ? match[0] : null;
  }, [clipboard?.type, clipboard?.text]);

  // 分享内容
  const handleShare = async () => {
    if (!clipboard) return;
    try {
      if (clipboard.type === 'Text' && !isTextInvalid(clipboard.text)) {
        await Share.share({ message: clipboard.text });
      } else if (clipboard.fileUri) {
        await shareFile(clipboard.fileUri, clipboard.fileName);
      }
    } catch (error) {
      console.error('[CurrentClipboardCard] Failed to share:', error);
    }
  };

  if (!clipboard) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
        ]}
      >
        <View style={styles.emptyContent}>
          <Text style={[styles.emptyIcon, { color: theme.colors.textTertiary }]}>📋</Text>
          <Text style={[styles.emptyTitle, { color: theme.colors.textSecondary }]}>
            {t('clipboard.empty')}
          </Text>
          <Text style={[styles.emptyDescription, { color: theme.colors.textTertiary }]}>
            {t('clipboard.emptyHint')}
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
      case 'Group':
        return '📄';
      default:
        return '📋';
    }
  };

  const getTypeLabel = (type: string): string => {
    switch (type) {
      case 'Text':
        return t('common.typeText');
      case 'Image':
        return t('common.typeImage');
      case 'File':
      case 'Group':
        return t('common.typeFile');
      default:
        return t('common.typeUnknown');
    }
  };

  const formatTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return t('common.timeJustNow');
    if (diff < 3600000) return t('common.timeMinutesAgo', { minutes: Math.floor(diff / 60000) });
    if (diff < 86400000) return t('common.timeHoursAgo', { hours: Math.floor(diff / 3600000) });

    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 获取预览文本
  const getPreviewText = (): string => {
    if (clipboard.type === 'Text') {
      return clipboard.text;
    }
    if (clipboard.type === 'Image') {
      return clipboard.fileName || t('clipboard.imageFallback');
    }
    if (clipboard.type === 'File') {
      return clipboard.fileName || t('clipboard.fileFallback');
    }
    if (clipboard.type === 'Group') {
      return clipboard.text || clipboard.fileName || t('clipboard.fileFallback');
    }
    return '';
  };

  const previewText = getPreviewText();
  const isLongText = previewText.length > 200;

  // 判断是否需要下载额外文件
  const needsFileDownload = (): boolean => {
    if (!isRemote || !clipboard) return false;

    // 文本类型：当 hasData 为 true 且有 fileName 但没有 fileUri 时，需要下载完整文本
    if (clipboard.type === 'Text') {
      const needsDownload = !!(clipboard.hasData && clipboard.fileName && !clipboard.fileUri);
      return needsDownload;
    }

    // 图片类型：有 fileName 但没有 fileUri 或 fileData
    if (clipboard.type === 'Image') {
      return !!(clipboard.fileName && !clipboard.fileUri && !clipboard.fileData);
    }

    // 文件类型：有 fileName 但没有 fileUri 或 fileData
    if (clipboard.type === 'File') {
      return !!(clipboard.fileName && !clipboard.fileUri && !clipboard.fileData);
    }

    // Group类型：有 fileName 但没有 fileUri 或 fileData
    if (clipboard.type === 'Group') {
      return !!(clipboard.fileName && !clipboard.fileUri && !clipboard.fileData);
    }

    return false;
  };

  const showActionButton = isRemote ? !!(onAction && needsFileDownload()) : !!onAction;

  // 可以"打开"的非文本类型（有 fileUri）- Group类型不支持打开
  const canOpenFile =
    clipboard.type !== 'Text' && clipboard.type !== 'Group' && !!clipboard.fileUri;

  // 打开文件
  const handleOpenFile = async () => {
    if (!clipboard.fileUri) return;
    try {
      await openFile(clipboard.fileUri);
    } catch (error) {
      console.error('[CurrentClipboardCard] Failed to open file:', error);
    }
  };

  // 判断是否显示分享按钮（非Text类型且有文件URI，Group类型除外）
  const canShowShareButton = (() => {
    if (!clipboard || clipboard.type === 'Text') return false;

    // Group类型不显示分享按钮
    if (clipboard.type === 'Group') return false;

    // 图片类型：需要有 fileUri
    if (clipboard.type === 'Image') return !!clipboard.fileUri;
    // 文件类型：需要有 fileUri
    if (clipboard.type === 'File') return !!clipboard.fileUri;

    return false;
  })();

  // 判断是否显示保存按钮（非Text类型且有文件URI）
  const canShowSaveButton = (() => {
    if (!clipboard || clipboard.type === 'Text') return false;

    // 图片类型：需要有 fileUri
    if (clipboard.type === 'Image') return !!clipboard.fileUri;
    // 文件类型：需要有 fileUri
    if (clipboard.type === 'File') return !!clipboard.fileUri;
    // Group类型：需要有 fileUri
    if (clipboard.type === 'Group') return !!clipboard.fileUri;

    return false;
  })();

  // 取消保存
  const handleCancelSave = () => {
    saveAbortControllerRef.current?.abort();
  };

  const canCancelSave = !!saveAbortControllerRef.current;

  // 保存文件到用户选择的目录（图片类型保存到相册）
  const handleSaveFile = async () => {
    if (!clipboard || !clipboard.fileUri) return;
    try {
      // 图片类型直接保存到相册
      if (clipboard.type === 'Image') {
        setIsSaving(true);
        await saveToGallery(clipboard.fileUri);
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

      // 创建 AbortController 用于取消
      const abortController = new AbortController();
      saveAbortControllerRef.current = abortController;
      setIsSaving(true);
      setSaveProgress(null);

      await saveContentDataToDirectory(
        clipboard,
        permissions.directoryUri,
        abortController.signal,
        (info) => setSaveProgress(info)
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
      console.error('[CurrentClipboardCard] Failed to save file:', error);
      showMessage(t('clipboard.saveFailed'), 'error');
    } finally {
      setIsSaving(false);
      setSaveProgress(null);
      saveAbortControllerRef.current = null;
    }
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
      ]}
    >
      {/* 标题栏 */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.typeIcon}>{getTypeIcon(clipboard.type)}</Text>
          <View style={styles.headerInfo}>
            <Text style={[styles.typeLabel, { color: theme.colors.text }]}>
              {getTypeLabel(clipboard.type)}
            </Text>
            <Text style={[styles.timestamp, { color: theme.colors.textSecondary }]}>
              {clipboard.timestamp ? formatTime(clipboard.timestamp) : t('common.timeJustNow')}
            </Text>
          </View>
        </View>

        {clipboard.fileSize !== undefined && (
          <Text style={[styles.sizeLabel, { color: theme.colors.textSecondary }]}>
            {formatSizeWithType(clipboard.fileSize, clipboard.type)}
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
                  key={`image-${clipboard.fileUri}-${clipboard.localClipboardHash?.substring(0, 12)}`}
                  source={{
                    uri: clipboard.fileUri,
                    cache: 'force-cache',
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
                  {clipboard.fileName || t('clipboard.imageFileLabel')}
                </Text>
              </View>
            )}
          </View>
        )}

        {clipboard.type === 'File' && (
          <View style={styles.mediaPreview}>
            <Text style={[styles.mediaLabel, { color: theme.colors.textSecondary }]}>
              {clipboard.fileName || t('common.typeFile')}
            </Text>
          </View>
        )}

        {clipboard.type === 'Group' && (
          <View style={styles.mediaPreview}>
            <Text style={[styles.mediaLabel, { color: theme.colors.textSecondary }]}>
              {clipboard.text || clipboard.fileName || t('common.typeFileGroup')}
            </Text>
          </View>
        )}
      </View>

      {/* 按钮区域 */}
      <View style={styles.actionButtons}>
        {/* 文本中包含 URL：打开链接按钮 */}
        {clipboard.type === 'Text' && detectedUrl && (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.colors.primary }]}
            onPress={() => Linking.openURL(detectedUrl)}
          >
            <Text
              style={[styles.actionButtonText, { color: theme.colors.white }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {t('clipboard.openLink')}
            </Text>
          </TouchableOpacity>
        )}

        {/* 文本类型：分词按钮 */}
        {clipboard.type === 'Text' && onWordPick && !isTextInvalid(clipboard.text) && (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.colors.primary }]}
            onPress={() => onWordPick(clipboard.text!)}
          >
            <Text
              style={[styles.actionButtonText, { color: theme.colors.white }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {t('clipboard.wordPick')}
            </Text>
          </TouchableOpacity>
        )}

        {/* 远程 Text 类型：只有在不需要下载时才显示复制按钮 */}
        {isRemote && clipboard.type === 'Text' && !showActionButton && (
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.actionButtonLast,
              { backgroundColor: theme.colors.primary },
            ]}
            onPress={() => onCopy(clipboard)}
          >
            <Text
              style={[styles.actionButtonText, { color: theme.colors.white }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {t('common.copy')}
            </Text>
          </TouchableOpacity>
        )}

        {/* 非文本且有文件：打开按钮 */}
        {canOpenFile && (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.colors.primary }]}
            onPress={handleOpenFile}
          >
            <Text
              style={[styles.actionButtonText, { color: theme.colors.white }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {t('clipboard.open')}
            </Text>
          </TouchableOpacity>
        )}

        {/* 非Text类型且已下载：保存按钮 */}
        {canShowSaveButton && (
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: theme.colors.primary },
              isSaving && styles.actionButtonLast,
              isSaving && !canCancelSave && styles.actionButtonDisabled,
            ]}
            onPress={isSaving && canCancelSave ? handleCancelSave : handleSaveFile}
            disabled={isSaving && !canCancelSave}
          >
            {isSaving && saveProgress && (
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: theme.colors.primary,
                    width: `${Math.min(saveProgress.progress * 100, 100)}%`,
                  },
                ]}
              />
            )}
            <Text
              style={[styles.actionButtonText, { color: theme.colors.white }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {isSaving && saveProgress && saveProgress.totalBytes > 0
                ? `${(saveProgress.progress * 100).toFixed(0)}% ${formatFileSize(
                    saveProgress.bytesTransferred
                  )} / ${formatFileSize(saveProgress.totalBytes)}`
                : isSaving
                  ? t('clipboard.saving')
                  : t('clipboard.save')}
            </Text>
          </TouchableOpacity>
        )}

        {/* 非Text类型且已下载：分享按钮 */}
        {canShowShareButton && (
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.actionButtonLast,
              { backgroundColor: theme.colors.primary },
            ]}
            onPress={handleShare}
          >
            <Text
              style={[styles.actionButtonText, { color: theme.colors.white }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {t('clipboard.share')}
            </Text>
          </TouchableOpacity>
        )}

        {/* 同步操作按钮 */}
        {showActionButton && (
          <TouchableOpacity
            style={[
              styles.actionButton,
              styles.secondaryButton,
              styles.actionButtonLast,
              { borderColor: theme.colors.primary },
            ]}
            onPress={acting ? onCancelAction : onAction}
          >
            {acting && actionProgress && (
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: theme.colors.primary,
                    width: `${actionProgress.progress * 100}%`,
                  },
                ]}
              />
            )}
            <Text
              style={[
                styles.actionButtonText,
                styles.secondaryButtonText,
                { color: theme.colors.primary },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {acting && actionProgress
                ? `${(actionProgress.progress * 100).toFixed(0)}%  ${formatFileSize(
                    actionProgress.bytesTransferred
                  )} / ${formatFileSize(actionProgress.totalBytes)}`
                : acting
                  ? t('common.cancel')
                  : isRemote
                    ? t('clipboard.download')
                    : t('clipboard.upload')}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Hash 信息 */}
      {isDebugMode && clipboard.profileHash && (
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
    borderWidth: 1,
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
    gap: 12,
  },
  actionButton: {
    flex: 1,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  actionButtonLast: {},
  actionButtonDisabled: {
    opacity: 0.7,
  },
  secondaryButton: {
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  actionButtonTextWrapper: {
    flex: 1,
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
  footer: {
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hashLabel: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    opacity: 0.15,
  },
});
