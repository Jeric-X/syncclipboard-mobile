import React, { useCallback, useMemo, useState } from 'react';
import { ToastAndroid, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SyncDirection } from '@/types/sync';
import { ClipboardContent } from '@/types/clipboard';
import {
  setRemoteClipboard,
  fetchRemoteClipboard,
  setLocalClipboardFromRemote,
} from '@/services/sync/ClipboardSyncActions';
import { localClipboard } from '@/services/clipboard/LocalClipboard';
import { openFile, shareFile, saveToGallery } from '@/utils/fileActions';
import { isTextInvalid } from '@/utils/index';
import { QuickLoadingPage, SuccessButtonConfig } from '@/components/QuickLoadingPage';
import { saveContentDataToDirectory } from '@/utils/clipboard/clipboardContentUtils';
import { saveSyncFileToUserPath } from '@/services/sync/SyncFileSaveService';
import type { ProgressInfo } from 'native-util';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';

interface QuickTileLoadingScreenProps {
  direction: SyncDirection;
  onLoadingComplete: () => void;
  overlayMode?: boolean;
}

export const QuickTileLoadingScreen: React.FC<QuickTileLoadingScreenProps> = ({
  direction,
  onLoadingComplete,
  overlayMode,
}) => {
  const isUpload = direction === SyncDirection.Upload;
  const { t } = useTranslation();

  // 用 state 存储下载的文件内容，触发重渲染以更新 successButtons prop
  const [fileContent, setFileContent] = useState<ClipboardContent | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [previewText, setPreviewText] = useState<string | undefined>(undefined);
  const [loadingText, setLoadingText] = useState<string>(
    isUpload ? t('quickTile.uploadingClipboard') : t('quickTile.downloadingClipboard')
  );

  const task = useCallback(
    async (signal: AbortSignal) => {
      setFileContent(null);
      setProgress(null);
      setPreviewText(undefined);

      let content: ClipboardContent | null | undefined;

      if (isUpload) {
        content = await localClipboard.getClipboardContent();
        if (!content) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          content = await localClipboard.getClipboardContent();
        }
        if (!content) throw new Error(t('quickTile.clipboardEmpty'));
        await setRemoteClipboard(content, signal, (info) => setProgress(info));
      } else {
        content = await fetchRemoteClipboard(signal);
        if (content.hasData) {
          setPreviewText(content.text);
        }
        content = await setLocalClipboardFromRemote((info) => setProgress(info), signal, content);

        if (content) {
          setLoadingText(t('quickTile.savingFile'));
          await saveSyncFileToUserPath(content, signal, (info) => setProgress(info));
        }

        if (content && content.type !== 'Text' && content.fileUri) {
          setFileContent(content);
        } else if (content && content.type === 'Text') {
          const urlRegex = /https?:\/\/[^\s<>"'()\]\[{}]+/i;
          const urlMatch = content.text.match(urlRegex);
          if (urlMatch) {
            setFileContent(content);
          }
        }
      }

      // 只有文本类型才显示 Toast 提示
      if (content && content.type === 'Text' && !isTextInvalid(content.text)) {
        const preview = content.text.trim().replace(/\s+/g, ' ');
        const toastMessage = preview.length > 40 ? preview.slice(0, 40) + '…' : preview;
        ToastAndroid.show(toastMessage, ToastAndroid.SHORT);
      }

      // 下载了非文本文件时，存入 state，触发重渲染更新 successButtons
      if (!isUpload && content && content.type !== 'Text' && content.fileUri) {
        setFileContent(content);
      }
    },
    [isUpload, t]
  );

  // 检测文本中的 URL
  const textUrl = useMemo(() => {
    if (!fileContent || fileContent.type !== 'Text' || !fileContent.text) return null;
    const urlRegex = /https?:\/\/[^\s<>"'()\]\[{}]+/i;
    const match = fileContent.text.match(urlRegex);
    return match ? match[0] : null;
  }, [fileContent]);

  // 统一的保存处理函数（按类型分支）
  const handleSave = useCallback(async () => {
    if (!fileContent || !fileContent.fileUri) return;

    try {
      // 图片类型直接保存到相册
      if (fileContent.type === 'Image') {
        await saveToGallery(fileContent.fileUri);
        ToastAndroid.show(t('clipboard.savedToGallery'), ToastAndroid.SHORT);
        return;
      }

      // Group / File 类型：选择目录后保存（Group 自动解压）
      const permissions =
        await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) {
        ToastAndroid.show(t('history.saveCanceled'), ToastAndroid.SHORT);
        return;
      }

      await saveContentDataToDirectory(fileContent, permissions.directoryUri);
      ToastAndroid.show(t('quickTile.savedToDevice'), ToastAndroid.SHORT);
    } catch (error) {
      console.error('[QuickTileLoadingScreen] Failed to save file:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      ToastAndroid.show(`${t('quickTile.saveFailed')}: ${errorMessage}`, ToastAndroid.LONG);
    }
  }, [fileContent, t]);

  const successButtons: SuccessButtonConfig[] | undefined = fileContent
    ? fileContent.type === 'Text' && textUrl
      ? [
          {
            label: t('common.copy'),
            primary: true,
            onPress: async () => {
              try {
                await Clipboard.setStringAsync(fileContent.text!);
                ToastAndroid.show(t('quickTile.copied'), ToastAndroid.SHORT);
              } catch {}
            },
          },
          {
            label: t('clipboard.openLink'),
            primary: true,
            onPress: async () => {
              try {
                await Linking.openURL(textUrl);
              } catch {}
            },
          },
        ]
      : fileContent.type === 'Group'
        ? [
            {
              label: t('clipboard.save'),
              primary: true,
              onPress: handleSave,
            },
          ]
        : [
            {
              label: t('clipboard.open'),
              primary: true,
              onPress: async () => {
                try {
                  await openFile(fileContent.fileUri!);
                } catch {}
              },
            },
            {
              label: t('clipboard.save'),
              primary: true,
              onPress: handleSave,
            },
            {
              label: t('clipboard.share'),
              primary: true,
              onPress: async () => {
                try {
                  await shareFile(fileContent.fileUri!, fileContent.fileName);
                } catch {}
              },
            },
          ]
    : undefined;

  return (
    <QuickLoadingPage
      task={task}
      loadingText={loadingText}
      successText={isUpload ? t('quickTile.uploadSuccess') : t('quickTile.syncSuccess')}
      failureText={isUpload ? t('quickTile.uploadFailed') : t('quickTile.syncFailed')}
      onComplete={onLoadingComplete}
      successContent={fileContent ?? undefined}
      successButtons={successButtons}
      progress={progress}
      previewText={previewText}
      overlayMode={overlayMode}
    />
  );
};
