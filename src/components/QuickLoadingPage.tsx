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
  TouchableOpacity,
  BackHandler,
} from 'react-native';
import { useTheme } from '@/hooks/useTheme';

type LoadingState = 'loading' | 'success' | 'error';

export interface QuickLoadingPageProps {
  /** 要执行的异步任务。抛出异常则进入 error 状态。 */
  task: () => Promise<void>;
  loadingText: string;
  successText: string;
  failureText: string;
  onComplete: () => void;
  /**
   * 成功后在 successText 下方追加显示的内容（如文件操作按钮）。
   * 提供时禁用自动关闭，页面停留并显示"返回"按钮等待用户操作。
   */
  successExtra?: React.ReactNode;
}

export const QuickLoadingPage: React.FC<QuickLoadingPageProps> = ({
  task,
  loadingText,
  successText,
  failureText,
  onComplete,
  successExtra,
}) => {
  const { theme } = useTheme();
  const [state, setState] = useState<LoadingState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 用 ref 持有 task，避免 task 引用变化触发 useEffect 重复执行
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  const run = useCallback(async () => {
    setState('loading');
    setErrorMessage(null);
    try {
      await taskRef.current();
      setState('success');
      // 没有 successExtra 时自动关闭
      if (!successExtra) {
        setTimeout(onComplete, 500);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '操作失败，请重试');
      setState('error');
    }
  }, [onComplete, successExtra]);

  useEffect(() => {
    run();
  }, [run]);

  // 返回键：loading 时屏蔽；error / success-with-extra 时允许离开
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state === 'loading') return true;
      if (state === 'error' || (state === 'success' && successExtra !== undefined)) {
        onComplete();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [state, successExtra, onComplete]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.content}>
        {state === 'loading' && (
          <>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[styles.statusText, { color: theme.colors.text }]}>{loadingText}</Text>
          </>
        )}

        {state === 'success' && (
          <>
            <Text style={[styles.successIcon, { color: theme.colors.success }]}>✓</Text>
            <Text style={[styles.statusText, { color: theme.colors.text }]}>{successText}</Text>
            {successExtra}
            {successExtra !== undefined && (
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
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
  button: {
    paddingHorizontal: 28,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  buttonOutline: {
    borderWidth: 1,
  },
});
