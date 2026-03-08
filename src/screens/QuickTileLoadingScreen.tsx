import React, { useCallback, useState } from 'react';
import { ToastAndroid } from 'react-native';
import { SyncDirection } from '@/types/sync';
import { ClipboardContent } from '@/types/clipboard';
import { SyncManager } from '@/services/SyncManager';
import { useSyncStore } from '@/stores/syncStore';
import { openFile, shareFile, saveFile } from '@/utils/fileActions';
import { QuickLoadingPage, SuccessButtonConfig } from '@/components/QuickLoadingPage';

interface QuickTileLoadingScreenProps {
  direction: SyncDirection;
  onLoadingComplete: () => void;
}

export const QuickTileLoadingScreen: React.FC<QuickTileLoadingScreenProps> = ({
  direction,
  onLoadingComplete,
}) => {
  const isUpload = direction === SyncDirection.Upload;

  // 用 state 存储下载的文件内容，触发重渲染以更新 successButtons prop
  const [fileContent, setFileContent] = useState<ClipboardContent | null>(null);

  const task = useCallback(
    async (signal: AbortSignal) => {
      setFileContent(null);

      // 确保 SyncManager 已初始化（冷启动时尚未经过正常启动流程）
      await useSyncStore.getState().initialize();
      const initError = useSyncStore.getState().error;
      if (initError) throw new Error(initError);

      const syncMgr = SyncManager.getInstance();
      const result = await syncMgr.sync(direction, false, signal);

      if (!result.success) {
        throw new Error(result.error || (isUpload ? '上传失败' : '同步失败'));
      }

      const content = result.content;
      let toastMessage = isUpload ? '上传成功' : '下载成功';
      if (content) {
        if (content.type === 'Text' && content.text) {
          const preview = content.text.trim().replace(/\s+/g, ' ');
          toastMessage = preview.length > 40 ? preview.slice(0, 40) + '…' : preview;
        } else if (content.fileName) {
          toastMessage = content.fileName;
        }
      }
      ToastAndroid.show(toastMessage, ToastAndroid.SHORT);

      // 下载了非文本文件时，存入 state，触发重渲染更新 successButtons
      if (!isUpload && content && content.type !== 'Text' && content.fileUri) {
        setFileContent(content);
      }
    },
    [direction, isUpload]
  );

  const successButtons: SuccessButtonConfig[] | undefined = fileContent
    ? [
        {
          label: '打开',
          primary: true,
          onPress: async () => {
            try {
              await openFile(fileContent.fileUri!);
            } catch {}
          },
        },
        {
          label: '保存',
          onPress: async () => {
            try {
              await saveFile(fileContent.fileUri!, fileContent.fileName);
            } catch {}
          },
        },
        {
          label: '分享',
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
      loadingText={isUpload ? '正在上传剪贴板...' : '正在下载剪贴板...'}
      successText={isUpload ? '上传成功！' : '同步成功！'}
      failureText={isUpload ? '上传失败' : '同步失败'}
      onComplete={onLoadingComplete}
      successContent={fileContent ?? undefined}
      successButtons={successButtons}
    />
  );
};
