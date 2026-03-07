import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ToastAndroid } from 'react-native';
import { SyncDirection } from '@/types/sync';
import { ClipboardContent } from '@/types/clipboard';
import { SyncManager } from '@/services/SyncManager';
import { useSyncStore } from '@/stores/syncStore';
import { useTheme } from '@/hooks/useTheme';
import { openFile, shareFile } from '@/utils/fileActions';
import { QuickLoadingPage } from '@/components/QuickLoadingPage';

interface QuickTileLoadingScreenProps {
  direction: SyncDirection;
  onLoadingComplete: () => void;
}

export const QuickTileLoadingScreen: React.FC<QuickTileLoadingScreenProps> = ({
  direction,
  onLoadingComplete,
}) => {
  const { theme } = useTheme();
  const isUpload = direction === SyncDirection.Upload;

  // 用 ref 存储下载的文件内容，避免 state 更新时机问题
  const downloadedContentRef = useRef<ClipboardContent | null>(null);

  const task = useCallback(async () => {
    downloadedContentRef.current = null;

    // 确保 SyncManager 已初始化（冷启动时尚未经过正常启动流程）
    await useSyncStore.getState().initialize();
    const initError = useSyncStore.getState().error;
    if (initError) throw new Error(initError);

    const syncMgr = SyncManager.getInstance();
    const result = await syncMgr.sync(direction);

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

    // 下载了非文本文件时，存入 ref，供 successExtra 显示文件操作按钮
    if (!isUpload && content && content.type !== 'Text' && content.fileUri) {
      downloadedContentRef.current = content;
    }
  }, [direction, isUpload]);

  // successExtra 从 ref 读取，在 task resolve 后 React 重渲染时 ref 已更新
  const fileContent = downloadedContentRef.current;
  const successExtra = fileContent ? (
    <>
      {fileContent.fileName && (
        <Text style={[styles.fileNameText, { color: theme.colors.textSecondary }]}>
          {fileContent.fileName}
        </Text>
      )}
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: theme.colors.primary }]}
          onPress={async () => {
            try {
              await openFile(fileContent.fileUri!);
            } catch {}
          }}
        >
          <Text style={[styles.buttonText, { color: theme.colors.white }]}>打开</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: theme.colors.primary }]}
          onPress={async () => {
            try {
              await shareFile(fileContent.fileUri!, fileContent.fileName);
            } catch {}
          }}
        >
          <Text style={[styles.buttonText, { color: theme.colors.white }]}>分享</Text>
        </TouchableOpacity>
      </View>
    </>
  ) : undefined;

  return (
    <QuickLoadingPage
      task={task}
      loadingText={isUpload ? '正在上传剪贴板...' : '正在下载剪贴板...'}
      successText={isUpload ? '上传成功！' : '同步成功！'}
      failureText={isUpload ? '上传失败' : '同步失败'}
      onComplete={onLoadingComplete}
      successExtra={successExtra}
    />
  );
};

const styles = StyleSheet.create({
  fileNameText: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 280,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
