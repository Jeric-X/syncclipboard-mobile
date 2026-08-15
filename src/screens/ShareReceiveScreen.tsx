/**
 * Share Receive Screen
 * 接收分享文件页面 - 当其他 App 分享文件到本 App 时显示
 * UI 和加载/成功/失败/重试逻辑完全复用 QuickTileLoadingScreen
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, StyleSheet, BackHandler } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIncomingShare, clearSharedPayloads, getSharedPayloads } from 'expo-sharing';
import { useTheme } from '@/hooks/useTheme';
import {
  createContentFromFile,
  createContentFromText,
} from '@/utils/clipboard/clipboardContentUtils';
import { setRemoteClipboard } from '@/services/sync/ClipboardSyncActions';
import { QuickLoadingPage } from '@/components/QuickLoadingPage';
import type { ProgressInfo } from 'native-util';

// Debug logging
const DEBUG = true;
function log(...args: unknown[]) {
  if (DEBUG) {
    console.log('[ShareReceiveScreen]', ...args);
  }
}

interface ShareReceiveScreenProps {
  onComplete: () => void;
  overlayMode?: boolean;
}

function getFileExtFromMime(mimeType: string | null | undefined): string {
  if (!mimeType) return '';
  const parts = mimeType.split('/');
  if (parts.length < 2) return '';
  const sub = parts[1].split(';')[0].trim();
  if (sub === 'jpeg') return '.jpg';
  if (sub === 'svg+xml') return '.svg';
  if (sub === 'plain') return '.txt';
  if (sub === 'octet-stream') return '';
  return `.${sub}`;
}

export const ShareReceiveScreen: React.FC<ShareReceiveScreenProps> = ({
  onComplete,
  overlayMode = false,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();

  const { resolvedSharedPayloads, isResolving, error: resolveError } = useIncomingShare();
  // 挂载时同步读取原始 payload，避免 hook 异步初始化导致误判"没有内容"
  const [hasShareContent] = useState(() => {
    const payloads = getSharedPayloads();
    log('Initial getSharedPayloads():', payloads);
    return payloads.length > 0;
  });
  const [loadingText, setLoadingText] = useState(() => t('shareReceive.processingFile'));
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [previewText, setPreviewText] = useState<string | undefined>(undefined);
  const [previewImage, setPreviewImage] = useState<string | undefined>(undefined);

  // Debug: Log resolved payloads
  useEffect(() => {
    log('resolvedSharedPayloads:', resolvedSharedPayloads);
    log('isResolving:', isResolving);
    log('resolveError:', resolveError);
  }, [resolvedSharedPayloads, isResolving, resolveError]);

  // 挂载时若根本没有分享内容，直接返回
  useEffect(() => {
    if (!hasShareContent) {
      log('No share content, exiting');
      clearSharedPayloads();
      onComplete();
    }
  }, []);

  // 上传任务：由 QuickTileLoadingScreen 调用（含重试）
  const task = useCallback(
    async (signal: AbortSignal) => {
      if (resolveError)
        throw new Error(t('shareReceive.resolveError', { error: resolveError.message }));

      const payload = resolvedSharedPayloads[0];
      if (!payload) throw new Error(t('shareReceive.noContent'));

      // 文字分享（text / url 类型，contentUri 为 null）
      // 或 URL 分享（浏览器分享链接时 contentUri 是 https:// 而非本地文件）
      if (!payload.contentUri || payload.shareType === 'url') {
        const text = payload.value?.trim() || '';
        if (!text) throw new Error(t('shareReceive.emptyText'));
        setLoadingText(t('shareReceive.uploadingText'));
        setPreviewText(text.slice(0, 100));
        const textContent = await createContentFromText(text, { signal });
        await setRemoteClipboard(textContent, signal);
        clearSharedPayloads();
        return;
      }

      // 文件分享
      const contentMime = payload.contentMimeType;
      let fileName = payload.originalName;
      if (!fileName) {
        const ext = getFileExtFromMime(contentMime);
        fileName = `shared_${Date.now()}${ext}`;
      }
      setPreviewText(fileName);

      // 如果是图片类型，设置预览图片
      if (contentMime?.startsWith('image/')) {
        setPreviewImage(payload.contentUri);
      }

      const content = await createContentFromFile(
        payload.contentUri,
        fileName,
        contentMime,
        undefined,
        { signal }
      );
      await setRemoteClipboard(content, signal, (info) => {
        setLoadingText(t('shareReceive.uploadingFile'));
        setProgress(info ?? null);
      });
      clearSharedPayloads();
    },
    [resolvedSharedPayloads, resolveError, t]
  );

  if (!hasShareContent) return null;

  // 等待 expo-sharing 解析分享内容
  if (isResolving && !resolveError) {
    return (
      <ResolvingView
        text={t('shareReceive.resolving')}
        backgroundColor={overlayMode ? theme.colors.backdrop : theme.colors.surface}
        textColor={theme.colors.text}
        primaryColor={theme.colors.primary}
        onBack={onComplete}
      />
    );
  }

  return (
    <QuickLoadingPage
      task={task}
      loadingText={loadingText}
      successText={t('shareReceive.success')}
      failureText={t('shareReceive.failed')}
      onComplete={onComplete}
      progress={progress}
      previewText={previewText}
      previewImage={previewImage}
      overlayMode={overlayMode}
    />
  );
};

/** 仅在等待 expo-sharing 解析阶段使用的极简 loading 界面 */
const ResolvingView: React.FC<{
  text: string;
  backgroundColor: string;
  textColor: string;
  primaryColor: string;
  onBack: () => void;
}> = ({ text, backgroundColor, textColor, primaryColor, onBack }) => {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <ActivityIndicator size="large" color={primaryColor} />
      <Text style={[styles.text, { color: textColor }]}>{text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  text: {
    fontSize: 16,
  },
});
