/**
 * QuickLoadingPage
 * 通用"快速加载"页：执行一个异步 task，处理 loading / success / error 状态显示。
 * 纯 UI + 状态机，不含任何业务逻辑。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  Image,
  TouchableOpacity,
  BackHandler,
} from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import type { ClipboardContent } from '@/types/clipboard';

type LoadingState = 'loading' | 'success' | 'error';

export interface SuccessButtonConfig {
  label: string;
  onPress: () => void;
  primary?: boolean;
}

export interface QuickLoadingPageProps {
  /** 要执行的异步任务。抛出异常则进入 error 状态。接收 AbortSignal 用于取消操作。 */
  task: (signal: AbortSignal) => Promise<void>;
  loadingText: string;
  successText: string;
  failureText: string;
  onComplete: () => void;
  /**
   * 成功后预览的剪贴板内容：文本显示文字、图片显示缩略图、文件显示文件名。
   * 提供时禁用自动关闭，页面停留并显示"返回"按钮等待用户操作。
   */
  successContent?: ClipboardContent;
  /**
   * 成功后与"返回"按钮并排显示的额外按钮（如打开、分享）。
   * 提供时禁用自动关闭，页面停留并显示按钮行等待用户操作。
   */
  successButtons?: SuccessButtonConfig[];
}

export const QuickLoadingPage: React.FC<QuickLoadingPageProps> = ({
  task,
  loadingText,
  successText,
  failureText,
  onComplete,
  successContent,
  successButtons,
}) => {
  const { theme } = useTheme();
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
      setErrorMessage(err instanceof Error ? err.message : '操作失败，请重试');
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

  // 成功后：无 successContent 且无 successButtons 时自动关闭
  // 放在独立 useEffect 中，确保在 React 批处理完成、父组件更新 successButtons prop 后再判断
  useEffect(() => {
    if (state !== 'success') return;
    if (successContent !== undefined || (successButtons && successButtons.length > 0)) return;
    const timer = setTimeout(onComplete, 500);
    return () => clearTimeout(timer);
  }, [state, successContent, successButtons, onComplete]);

  // 返回键：loading 时允许取消；error / success-with-content/extra 时允许离开
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
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
  }, [state, successContent, successButtons, onComplete, handleCancel]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.content}>
        {state === 'loading' && (
          <>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[styles.statusText, { color: theme.colors.text }]}>{loadingText}</Text>
            <TouchableOpacity
              style={[
                styles.button,
                styles.buttonOutline,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
              onPress={handleCancel}
            >
              <Text style={[styles.buttonText, { color: theme.colors.text }]}>取消</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'success' && (
          <>
            {successContent && <ContentPreview content={successContent} />}
            <Text style={[styles.successIcon, { color: theme.colors.success }]}>✓</Text>
            <Text style={[styles.statusText, { color: theme.colors.text }]}>{successText}</Text>
            {(successContent !== undefined || (successButtons && successButtons.length > 0)) && (
              <View style={styles.successButtonRow}>
                {successButtons?.map((btn, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.button,
                      styles.successButton,
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
                    <Text
                      style={[
                        styles.buttonText,
                        { color: btn.primary ? theme.colors.white : theme.colors.text },
                      ]}
                    >
                      {btn.label}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.successButton,
                    styles.buttonOutline,
                    { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                  ]}
                  onPress={onComplete}
                >
                  <Text style={[styles.buttonText, { color: theme.colors.text }]}>返回</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {state === 'error' && (
          <>
            <Text style={[styles.errorIcon, { color: theme.colors.error }]}>✗</Text>
            <Text style={[styles.statusText, { color: theme.colors.text }]}>{failureText}</Text>
            {errorMessage && (
              <Text style={[styles.errorDetailText, { color: theme.colors.textTertiary }]}>
                {errorMessage}
              </Text>
            )}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.colors.primary }]}
                onPress={run}
              >
                <Text style={[styles.buttonText, { color: theme.colors.white }]}>重试</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.button,
                  styles.buttonOutline,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
                onPress={onComplete}
              >
                <Text style={[styles.buttonText, { color: theme.colors.text }]}>返回</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
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

  if (content.type === 'Text' && content.text) {
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
  const label = content.fileName ?? content.text ?? '未知文件';
  const size = content.fileSize != null ? ` · ${(content.fileSize / 1024).toFixed(1)} KB` : '';
  return (
    <View
      style={[
        styles.previewFileBox,
        { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
      ]}
    >
      <Text style={[styles.previewFileIcon, { color: theme.colors.primary }]}>📄</Text>
      <Text style={[styles.previewFileName, { color: theme.colors.text }]} numberOfLines={2}>
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
    gap: 16,
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
  errorDetailText: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 280,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  successButtonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    width: '100%',
  },
  successButton: {
    flex: 1,
    paddingHorizontal: 0,
  },
  button: {
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
  previewImage: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 320,
    borderRadius: 12,
  },
  previewTextBox: {
    width: 280,
    maxHeight: 160,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  previewText: {
    fontSize: 14,
    lineHeight: 20,
  },
  previewFileBox: {
    width: 280,
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
});
