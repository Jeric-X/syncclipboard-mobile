import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToastAndroid, Linking, Platform } from 'react-native';
import { Copy, ExternalLink, Download, Share } from 'react-native-feather';
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
  const [canCancelSave, setCanCancelSave] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | undefined>();
  const activeActionRef = useRef<'copy' | 'save' | null>(null);
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
        } else if (content?.type === 'Text' && !isTextInvalid(content.text)) {
          setFileContent(content);
        }
      }

      // 下载文字在成功页预览，上传文字仍使用 Toast 提示。
      if (isUpload && content?.type === 'Text' && !isTextInvalid(content.text)) {
        const preview = content.text.trim().replace(/\s+/g, ' ');
        const toastMessage = preview.length > 40 ? preview.slice(0, 40) + '…' : preview;
        if (Platform.OS === 'android') ToastAndroid.show(toastMessage, ToastAndroid.SHORT);
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

  const handleCopy = useCallback(async () => {
    if (!fileContent || activeActionRef.current) return;
    if (fileContent.type !== 'Text' && fileContent.type !== 'Image') return;
    if (fileContent.type === 'Image' && !fileContent.fileUri) return;

    activeActionRef.current = 'copy';
    setIsCopying(true);
    setCopyError(undefined);
    try {
      await localClipboard.setClipboardContent(fileContent, true);
      if (Platform.OS === 'android') ToastAndroid.show(t('quickTile.copied'), ToastAndroid.SHORT);
      onLoadingComplete();
    } catch (error) {
      console.error('[QuickTileLoadingScreen] Failed to copy content:', error);
      setCopyError(t('clipboard.copyFailed'));
    } finally {
      activeActionRef.current = null;
      setIsCopying(false);
    }
  }, [fileContent, onLoadingComplete, t]);

  // 取消保存
  const handleCancelSave = useCallback(() => {
    saveAbortControllerRef.current?.abort();
  }, []);
  const handleSavingPress = useCallback(() => {}, []);

  // 统一的保存处理函数（按类型分支）
  const handleSave = useCallback(async () => {
    if (!fileContent || !fileContent.fileUri || activeActionRef.current) return;

    activeActionRef.current = 'save';
    setIsSaving(true);

    try {
      // 图片类型直接保存到相册
      if (fileContent.type === 'Image') {
        await saveToGallery(fileContent.fileUri);
        if (Platform.OS === 'android') {
          ToastAndroid.show(t('clipboard.savedToGallery'), ToastAndroid.SHORT);
        }
        return;
      }

      // Group / File 类型：选择目录后保存（Group 自动解压）
      const permissions =
        await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) {
        if (Platform.OS === 'android')
          ToastAndroid.show(t('history.saveCanceled'), ToastAndroid.SHORT);
        return;
      }

      const abortController = new AbortController();
      saveAbortControllerRef.current = abortController;
      setCanCancelSave(true);
      setSaveProgress(null);

      await saveContentDataToDirectory(
        fileContent,
        permissions.directoryUri,
        abortController.signal,
        (info) => setSaveProgress(info)
      );
      if (Platform.OS === 'android')
        ToastAndroid.show(t('quickTile.savedToDevice'), ToastAndroid.SHORT);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // 用户取消，不显示错误
        return;
      }
      console.error('[QuickTileLoadingScreen] Failed to save file:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (Platform.OS === 'android') {
        ToastAndroid.show(`${t('quickTile.saveFailed')}: ${errorMessage}`, ToastAndroid.LONG);
      }
    } finally {
      setIsSaving(false);
      setCanCancelSave(false);
      setSaveProgress(null);
      saveAbortControllerRef.current = null;
      activeActionRef.current = null;
    }
  }, [fileContent, t]);

  // 动态保存按钮配置（根据保存状态切换 label 和行为）
  const saveButtonConfig = useMemo((): SuccessButtonConfig => {
    if (isSaving) {
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
        primary: fileContent?.type === 'Group',
        icon: Download,
        fullWidth: true,
        disabled: !canCancelSave,
        onPress: canCancelSave ? handleCancelSave : handleSavingPress,
      };
    }
    return {
      label: t('clipboard.save'),
      primary: fileContent?.type === 'Group',
      icon: Download,
      disabled: isCopying,
      onPress: handleSave,
    };
  }, [
    isSaving,
    canCancelSave,
    isCopying,
    fileContent?.type,
    saveProgress,
    handleCancelSave,
    handleSavingPress,
    handleSave,
    t,
  ]);

  const copyButton: SuccessButtonConfig = {
    label: t('quickTile.copyAndReturn'),
    primary: true,
    icon: Copy,
    busy: isCopying,
    disabled: isCopying || isSaving,
    onPress: handleCopy,
  };

  const successButtons: SuccessButtonConfig[] | undefined = fileContent
    ? fileContent.type === 'Text'
      ? textUrl
        ? [
            copyButton,
            {
              label: t('clipboard.openLink'),
              fullWidth: true,
              icon: ExternalLink,
              disabled: isCopying,
              onPress: async () => {
                try {
                  await Linking.openURL(textUrl);
                } catch {}
              },
            },
          ]
        : undefined
      : fileContent.type === 'Group'
        ? [saveButtonConfig]
        : [
            ...(fileContent.type === 'Image' ? [copyButton] : []),
            {
              label: t('clipboard.open'),
              primary: fileContent.type === 'File',
              icon: ExternalLink,
              disabled: isCopying || isSaving,
              onPress: async () => {
                try {
                  await openFile(fileContent.fileUri!);
                } catch {}
              },
            },
            saveButtonConfig,
            {
              label: t('clipboard.share'),
              icon: Share,
              disabled: isCopying || isSaving,
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
      successText={
        isUpload
          ? t('quickTile.uploadSuccess')
          : fileContent?.type === 'Image'
            ? t('quickTile.imageDownloaded')
            : fileContent?.type === 'Text'
              ? t('quickTile.textCopied')
              : fileContent
                ? t('quickTile.fileDownloaded')
                : t('quickTile.syncSuccess')
      }
      failureText={isUpload ? t('quickTile.uploadFailed') : t('quickTile.syncFailed')}
      onComplete={onLoadingComplete}
      successContent={fileContent ?? undefined}
      successButtons={successButtons}
      successError={copyError}
      autoCloseDelayMs={fileContent?.type === 'Text' && !textUrl ? 1200 : undefined}
      progress={progress}
      previewText={previewText}
      overlayMode={overlayMode}
      disableDismiss={isSaving || isCopying}
    />
  );
};
