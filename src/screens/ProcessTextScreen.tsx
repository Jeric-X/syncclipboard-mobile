/**
 * Process Text Screen
 * 处理来自 Android 文字选中菜单（PROCESS_TEXT）的上传请求。
 */

import React, { useCallback } from 'react';
import { QuickLoadingPage } from '@/components/QuickLoadingPage';
import { useSettingsStore } from '@/stores/settingsStore';
import { createContentFromText } from '@/utils/clipboard/clipboardContentUtils';
import { setRemoteClipboard } from '@/services/sync/ClipboardSyncActions';

interface ProcessTextScreenProps {
  text: string;
  onComplete: () => void;
}

export const ProcessTextScreen: React.FC<ProcessTextScreenProps> = ({ text, onComplete }) => {
  const activeServer = useSettingsStore((s) => s.getActiveServer());

  const task = useCallback(
    async (signal: AbortSignal) => {
      if (!activeServer) throw new Error('请先在设置中配置服务器');
      const content = await createContentFromText(text, { signal });
      await setRemoteClipboard(content, signal);
    },
    [text, activeServer]
  );

  return (
    <QuickLoadingPage
      task={task}
      loadingText="正在上传文字…"
      successText="上传成功"
      failureText="上传失败"
      onComplete={onComplete}
      previewText={text.length > 50 ? `${text.slice(0, 50)}…` : text}
    />
  );
};
