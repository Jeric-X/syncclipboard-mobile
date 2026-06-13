import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { isTextInvalid, formatFileSize } from '@/utils/index';
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

  // 保存操作状态
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<ProgressInfo | null>(null);
  const saveAbortControllerRef = useRef<AbortController | null>(null);

  // 组件卸载时取消正在进行的保存操作
  useEffect(() => {
    return () => {
      saveAbortControllerRef.current?.abort();
    };
  }, []);

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

  // 取消保存
  const handleCancelSave = useCallback(() => {
    saveAbortControllerRef.current?.abort();
  }, []);
  const handleSavingPress = useCallback(() => {}, []);

  // 统一的保存处理函数（按类型分支）
  const handleSave = useCallback(async () => {
    if (!fileContent || !fileContent.fileUri) return;

    try {
      // 图片类型直接保存到相册
      if (fileContent.type === 'Image') {
        setIsSaving(true);
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

      const abortController = new AbortController();
      saveAbortControllerRef.current = abortController;
      setIsSaving(true);
      setSaveProgress(null);

      await saveContentDataToDirectory(
        fileContent,
        permissions.directoryUri,
        abortController.signal,
        (info) => setSaveProgress(info)
      );
      ToastAndroid.show(t('quickTile.savedToDevice'), ToastAndroid.SHORT);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // 用户取消，不显示错误
        return;
      }
      console.error('[QuickTileLoadingScreen] Failed to save file:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      ToastAndroid.show(`${t('quickTile.saveFailed')}: ${errorMessage}`, ToastAndroid.LONG);
    } finally {
      setIsSaving(false);
      setSaveProgress(null);
      saveAbortControllerRef.current = null;
    }
  }, [fileContent, t]);

  // 动态保存按钮配置（根据保存状态切换 label 和行为）
  const saveButtonConfig = useMemo((): SuccessButtonConfig => {
    if (isSaving) {
      const canCancelSave = !!saveAbortControllerRef.current;
      let label: string;
      if (saveProgress && saveProgress.totalBytes > 0) {
        const pct = (saveProgress.progress * 100).toFixed(0);
        const transferred = formatFileSize(saveProgress.bytesTransferred);
        const total = formatFileSize(saveProgress.totalBytes);
        label = `${pct}% ${transferred} / ${total}`;
      } else {
        label = t('clipboard.saving');
      }
      return {
        label,
        primary: true,
        onPress: canCancelSave ? handleCancelSave : handleSavingPress,
      };
    }
    return {
      label: t('clipboard.save'),
      primary: true,
      onPress: handleSave,
    };
  }, [isSaving, saveProgress, handleCancelSave, handleSavingPress, handleSave, t]);

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
        ? [saveButtonConfig]
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
            saveButtonConfig,
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
      disableBackdropClose={isSaving}
    />
  );
};
