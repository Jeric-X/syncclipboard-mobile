/**
 * QuickLoadingPage
 * 通用"快速加载"页：执行一个异步 task，处理 loading / success / error 状态显示。
 * 纯 UI + 状态机，不含任何业务逻辑。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  Image,
  TouchableOpacity,
  TouchableWithoutFeedback,
  BackHandler,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from 'react-i18next';
import type { ClipboardContent } from '@/types/clipboard';
import type { ProgressInfo } from 'native-util';
import { formatFileSize, isTextInvalid } from '@/utils';

type LoadingState = 'loading' | 'success' | 'error';

export interface SuccessButtonConfig {
  label: string;
  onPress: () => void;
  primary?: boolean;
  icon?: React.ComponentType<{ width: number; height: number; color: string }>;
  disabled?: boolean;
  busy?: boolean;
  fullWidth?: boolean;
}

export interface QuickLoadingPageProps {
  task: (signal: AbortSignal) => Promise<void>;
  loadingText: string;
  successText: string;
  failureText: string;
  onComplete: () => void;
  successContent?: ClipboardContent;
  successButtons?: SuccessButtonConfig[];
  successError?: string;
  /** 提供字符串时预留单行状态区域，避免操作进度变化导致按钮布局跳动。 */
  successStatus?: string;
  /** 成功后保留预览的时间；不设置时沿用原有关闭行为。 */
  autoCloseDelayMs?: number;
  progress?: ProgressInfo | null;
  previewText?: string;
  previewImage?: string;
  /** When true, renders as a floating card over a semi-transparent backdrop (for transparent Activity). */
  overlayMode?: boolean;
  /** 保存或复制期间，禁止通过返回按钮、系统返回键或背景关闭。 */
  disableDismiss?: boolean;
}

export const QuickLoadingPage: React.FC<QuickLoadingPageProps> = ({
  task,
  loadingText,
  successText,
  failureText,
  onComplete,
  successContent,
  successButtons,
  successError,
  successStatus,
  autoCloseDelayMs,
  progress,
  previewText,
  previewImage,
  overlayMode,
  disableDismiss,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { fontScale } = useWindowDimensions();
  const secondaryButtonSize = { minWidth: 44 + 40 * fontScale };
  const [state, setState] = useState<LoadingState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 用 ref 持有 task，避免 task 引用变化触发 useEffect 重复执行
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  // AbortController 用于取消任务
  const abortControllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    setState('loading');
    setErrorMessage(null);

    // 创建新的 AbortController
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      await taskRef.current(signal);
      setState('success');
    } catch (err) {
      // 如果是取消操作，直接返回，不显示错误
      if (signal.aborted) {
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : t('common.defaultError'));
      setState('error');
    }
  }, [onComplete]);

  useEffect(() => {
    run();
    return () => {
      // 组件卸载时取消任务
      abortControllerRef.current?.abort();
    };
  }, [run]);

  // 取消任务
  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    onComplete();
  }, [onComplete]);

  // 成功后：指定延迟时先展示预览，否则无内容、无操作时立即关闭。
  // 放在独立 useEffect 中，确保在 React 批处理完成、父组件更新 successButtons prop 后再判断
  useEffect(() => {
    if (state !== 'success') return;
    if (autoCloseDelayMs !== undefined) {
      const timer = setTimeout(onComplete, autoCloseDelayMs);
      return () => clearTimeout(timer);
    }
    if (successContent !== undefined || (successButtons && successButtons.length > 0)) return;
    // 无需显示成功界面，直接退出
    onComplete();
  }, [state, successContent, successButtons, onComplete, autoCloseDelayMs]);

  // 返回键：loading 时允许取消；error / success-with-content/extra 时允许离开
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (disableDismiss) return true;
      if (state === 'loading') {
        handleCancel();
        return true;
      }
      if (
        state === 'error' ||
        (state === 'success' &&
          (successContent !== undefined || (successButtons && successButtons.length > 0)))
      ) {
        onComplete();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [state, successContent, successButtons, onComplete, handleCancel, disableDismiss]);

  const containerBg = overlayMode
    ? { backgroundColor: 'transparent' }
    : { backgroundColor: theme.colors.surface };

  const progressFillDynamic = useMemo(
    () => ({
      backgroundColor: theme.colors.primary,
      width:
        (progress?.totalBytes ?? 0) > 0
          ? (`${(progress?.progress ?? 0) * 100}%` as const)
          : ('100%' as const),
    }),
    [theme.colors.primary, progress?.totalBytes, progress?.progress]
  );

  const contentView = (
    <View
      onStartShouldSetResponder={() => true}
      style={[
        styles.content,
        overlayMode && [
          styles.overlayCard,
          styles.overlayCardShadow,
          { backgroundColor: theme.colors.surface, shadowColor: theme.colors.shadow },
        ],
      ]}
    >
      <ScrollView style={styles.contentScroll} contentContainerStyle={styles.scrollContent}>
        {state === 'loading' && (
          <>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[styles.statusText, { color: theme.colors.text }]}>{loadingText}</Text>
            {previewImage && (
              <Image source={{ uri: previewImage }} style={styles.loadingPreviewImage} />
            )}
            {previewText && (
              <Text style={[styles.loadingPreviewText, { color: theme.colors.textSecondary }]}>
                {previewText}
              </Text>
            )}
            {progress && (progress.totalBytes > 0 || progress.bytesTransferred > 0) && (
              <View style={styles.progressContainer}>
                <View style={[styles.progressBar, { backgroundColor: theme.colors.border }]}>
                  <View
                    style={[
                      styles.progressFill,
                      progressFillDynamic,
                      progress.totalBytes <= 0 && styles.progressFillIndeterminate,
                    ]}
                  />
                </View>
                <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
                  {progress.totalBytes > 0
                    ? `${(progress.progress * 100).toFixed(0)}% ${formatFileSize(
                        progress.bytesTransferred
                      )} / ${formatFileSize(progress.totalBytes)}`
                    : formatFileSize(progress.bytesTransferred)}
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={[
                styles.button,
                styles.buttonOutline,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
              onPress={handleCancel}
            >
              <Text style={[styles.buttonText, { color: theme.colors.text }]}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'success' && (
          <>
            {(successContent !== undefined || !!successButtons?.length) && (
              <Text style={[styles.successTitle, { color: theme.colors.text }]}>{successText}</Text>
            )}
            {successContent && <ContentPreview content={successContent} />}
            {successContent === undefined && !successButtons?.length && (
              <>
                <Text style={[styles.successIcon, { color: theme.colors.success }]}>✓</Text>
                <Text style={[styles.statusText, { color: theme.colors.text }]}>{successText}</Text>
              </>
            )}
            {autoCloseDelayMs !== undefined ? (
              <Text style={[styles.autoReturnText, { color: theme.colors.textSecondary }]}>
                {t('common.autoReturning')}
              </Text>
            ) : (
              (successContent !== undefined || (successButtons && successButtons.length > 0)) && (
                <View style={styles.successActions}>
                  {successError && (
                    <Text
                      accessibilityRole="alert"
                      style={[styles.errorDetailText, { color: theme.colors.error }]}
                    >
                      {successError}
                    </Text>
                  )}
                  <View style={styles.successButtonRow}>
                    {successButtons?.map((btn, index) => {
                      const Icon = btn.icon;
                      const fullWidth = btn.primary || btn.fullWidth;
                      const color = btn.primary ? theme.colors.white : theme.colors.text;
                      return (
                        <TouchableOpacity
                          key={index}
                          accessibilityRole="button"
                          accessibilityLabel={btn.label}
                          accessibilityState={{ disabled: btn.disabled, busy: btn.busy }}
                          disabled={btn.disabled}
                          style={[
                            styles.button,
                            styles.successButton,
                            fullWidth
                              ? styles.fullWidthButton
                              : [styles.secondaryButton, secondaryButtonSize],
                            btn.disabled && styles.disabledButton,
                            btn.primary
                              ? { backgroundColor: theme.colors.primary }
                              : [
                                  styles.buttonOutline,
                                  {
                                    backgroundColor: theme.colors.surface,
                                    borderColor: theme.colors.border,
                                  },
                                ],
                          ]}
                          onPress={btn.onPress}
                        >
                          {btn.busy ? (
                            <ActivityIndicator size="small" color={color} />
                          ) : (
                            Icon && <Icon width={18} height={18} color={color} />
                          )}
                          <Text style={[styles.buttonText, styles.actionButtonText, { color }]}>
                            {btn.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {successStatus !== undefined && (
                    <Text
                      accessibilityLiveRegion="polite"
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      style={[
                        styles.actionStatus,
                        { color: theme.colors.textSecondary, height: 20 * fontScale },
                      ]}
                    >
                      {successStatus || ' '}
                    </Text>
                  )}
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t('common.back')}
                    accessibilityState={{ disabled: disableDismiss }}
                    disabled={disableDismiss}
                    style={[
                      styles.button,
                      styles.backButton,
                      disableDismiss && styles.disabledButton,
                    ]}
                    onPress={onComplete}
                  >
                    <Text style={[styles.buttonText, { color: theme.colors.textSecondary }]}>
                      {t('common.back')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )
            )}
          </>
        )}

        {state === 'error' && (
          <>
            <Text style={[styles.errorIcon, { color: theme.colors.error }]}>✗</Text>
            <Text style={[styles.statusText, { color: theme.colors.text }]}>{failureText}</Text>
            {errorMessage && (
              <ScrollView
                style={[styles.errorDetailScroll, { borderColor: theme.colors.border }]}
                contentContainerStyle={styles.errorDetailScrollContent}
              >
                <Text style={[styles.errorDetailText, { color: theme.colors.textTertiary }]}>
                  {errorMessage}
                </Text>
              </ScrollView>
            )}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.colors.primary }]}
                onPress={run}
              >
                <Text style={[styles.buttonText, { color: theme.colors.white }]}>
                  {t('common.retry')}
                </Text>
              </TouchableOpacity>
              {errorMessage && (
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.buttonOutline,
                    { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                  ]}
                  onPress={() => Clipboard.setStringAsync(errorMessage)}
                >
                  <Text style={[styles.buttonText, { color: theme.colors.text }]}>
                    {t('common.copy')}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[
                  styles.button,
                  styles.buttonOutline,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
                onPress={onComplete}
              >
                <Text style={[styles.buttonText, { color: theme.colors.text }]}>
                  {t('common.back')}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );

  return (
    <View style={[styles.container, containerBg]}>
      {overlayMode ? (
        <TouchableWithoutFeedback
          accessible={false}
          onPress={() => {
            if (disableDismiss) return;
            if (state !== 'loading') onComplete();
          }}
        >
          <View style={styles.overlayBackdrop}>{contentView}</View>
        </TouchableWithoutFeedback>
      ) : (
        contentView
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// ContentPreview – inline preview of a ClipboardContent result
// ---------------------------------------------------------------------------

const ContentPreview: React.FC<{ content: ClipboardContent }> = ({ content }) => {
  const { theme } = useTheme();

  if (content.type === 'Image' && content.fileUri) {
    return (
      <Image source={{ uri: content.fileUri }} style={styles.previewImage} resizeMode="contain" />
    );
  }

  if (content.type === 'Text' && !isTextInvalid(content.text)) {
    return (
      <View
        style={[
          styles.previewTextBox,
          { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
        ]}
      >
        <Text
          style={[styles.previewText, { color: theme.colors.text }]}
          numberOfLines={6}
          ellipsizeMode="tail"
        >
          {content.text}
        </Text>
      </View>
    );
  }

  // File (or Image without local URI)
  const label = content.text || content.fileName || '未知文件';
  const size = content.fileSize != null ? ` · ${(content.fileSize / 1024).toFixed(1)} KB` : '';
  return (
    <View
      style={[
        styles.previewFileBox,
        { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
      ]}
    >
      <Text style={[styles.previewFileIcon, { color: theme.colors.primary }]}>📄</Text>
      <Text style={[styles.previewFileName, { color: theme.colors.text }]} numberOfLines={10}>
        {label}
      </Text>
      {size !== '' && (
        <Text style={[styles.previewFileMeta, { color: theme.colors.textTertiary }]}>
          {size.trim()}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: 24,
    maxHeight: '90%',
  },
  contentScroll: {
    width: '100%',
    flexGrow: 0,
  },
  scrollContent: {
    alignItems: 'center',
    gap: 16,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  autoReturnText: {
    fontSize: 13,
    textAlign: 'center',
  },
  statusText: {
    fontSize: 16,
  },
  successIcon: {
    fontSize: 48,
  },
  errorIcon: {
    fontSize: 48,
  },
  errorDetailScroll: {
    maxHeight: 200,
    width: '100%',
    maxWidth: 280,
    borderRadius: 8,
    borderWidth: 1,
  },
  errorDetailScrollContent: {
    padding: 12,
  },
  errorDetailText: {
    fontSize: 14,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  successButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    width: '100%',
  },
  successActions: {
    width: '100%',
    gap: 10,
  },
  successButton: {
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  fullWidthButton: {
    width: '100%',
  },
  secondaryButton: {
    flexGrow: 1,
    flexBasis: 0,
  },
  actionButtonText: {
    flexShrink: 1,
  },
  actionStatus: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    width: '100%',
  },
  backButton: {
    width: '100%',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  buttonOutline: {
    borderWidth: 1,
  },
  loadingPreviewText: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 280,
  },
  loadingPreviewImage: {
    width: 120,
    height: 120,
    borderRadius: 8,
    resizeMode: 'cover',
  },
  progressContainer: {
    width: '100%',
    maxWidth: 280,
    alignItems: 'center',
    gap: 8,
  },
  progressBar: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressFillIndeterminate: {
    opacity: 0.3,
  },
  progressText: {
    fontSize: 13,
  },
  previewImage: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 320,
    borderRadius: 12,
  },
  previewTextBox: {
    width: '100%',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  previewText: {
    fontSize: 14,
    lineHeight: 20,
  },
  previewFileBox: {
    width: '100%',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
    gap: 6,
  },
  previewFileIcon: {
    fontSize: 32,
  },
  previewFileName: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  previewFileMeta: {
    fontSize: 12,
  },
  overlayBackdrop: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayCard: {
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 24,
    width: '85%',
    alignSelf: 'center',
    elevation: 12,
  },
  overlayCardShadow: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
});
