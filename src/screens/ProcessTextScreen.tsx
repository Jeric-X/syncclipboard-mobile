/**
 * Process Text Screen
 * 处理来自 Android 文字选中菜单（PROCESS_TEXT）的上传请求。
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { QuickLoadingPage } from '@/components/QuickLoadingPage';
import { createContentFromText } from '@/utils/clipboard/clipboardContentUtils';
import { setRemoteClipboard } from '@/services/sync/ClipboardSyncActions';

interface ProcessTextScreenProps {
  text: string;
  onComplete: () => void;
  overlayMode?: boolean;
}

export const ProcessTextScreen: React.FC<ProcessTextScreenProps> = ({
  text,
  onComplete,
  overlayMode = false,
}) => {
  const { t } = useTranslation();

  const task = useCallback(
    async (signal: AbortSignal) => {
      const content = await createContentFromText(text, { signal });
      await setRemoteClipboard(content, signal);
    },
    [text, t]
  );

  return (
    <QuickLoadingPage
      task={task}
      loadingText={t('processText.uploadingText')}
      successText={t('processText.uploadSuccess')}
      failureText={t('processText.uploadFailed')}
      onComplete={onComplete}
      previewText={text.length > 50 ? `${text.slice(0, 50)}…` : text}
      overlayMode={overlayMode}
    />
  );
};
