/**
 * Clipboard Store
 * 剪贴板状态管理 - 使用 Zustand
 */

import { create } from 'zustand';
import { ClipboardContent } from '../types/clipboard';
import { localClipboard, clipboardMonitor } from '../services';

/**
 * 剪贴板状态接口
 */
interface ClipboardState {
  // 状态
  /** 当前剪贴板内容 */
  currentContent: ClipboardContent | null;

  /** 是否正在监听剪贴板 */
  isMonitoring: boolean;

  /** 是否正在加载 */
  isLoading: boolean;

  /** 错误信息 */
  error: string | null;

  // 动作
  /** 获取剪贴板内容 */
  getContent: () => Promise<void>;

  /** 开始监听剪贴板 */
  startMonitoring: () => Promise<void>;

  /** 停止监听剪贴板 */
  stopMonitoring: () => void;

  /** 更新本地轮询间隔 */
  updatePollingInterval: (interval: number) => void;

  /** 仅更新本地剪贴板卡片显示，不写系统剪贴板、不添加历史记录 */
  setCurrentContentDisplay: (content: ClipboardContent) => void;

  /** 清除错误 */
  clearError: () => void;

  /** 重置状态 */
  reset: () => void;
}

/**
 * 初始状态
 */
const initialState = {
  currentContent: null,
  isMonitoring: false,
  isLoading: false,
  error: null,
};

/**
 * 创建剪贴板 Store
 */
export const useClipboardStore = create<ClipboardState>((set, get) => ({
  ...initialState,

  getContent: async () => {
    set({ isLoading: true, error: null });

    try {
      const content = await localClipboard.getClipboardContent();

      // 剪贴板读取返回空时（如 Android 后台→前台瞬间的权限延迟），保留已有内容
      if (!content) {
        set({ isLoading: false });
        return;
      }

      // 如果内容未变化（localClipboardHash 相同），跳过状态更新，避免 Image 组件因
      // key 中的 timestamp 变化而重新挂载导致闪烁（切换前后台场景）
      const currentContent = get().currentContent;
      if (
        currentContent &&
        content.localClipboardHash &&
        currentContent.localClipboardHash &&
        content.localClipboardHash === currentContent.localClipboardHash
      ) {
        set({ isLoading: false });
        return;
      }

      set({ currentContent: content, isLoading: false });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to get clipboard content';
      set({ error: errorMessage, isLoading: false });
    }
  },

  startMonitoring: async () => {
    if (get().isMonitoring) {
      return;
    }

    set({ isMonitoring: true });

    clipboardMonitor.addCallback((content) => {
      console.log('[ClipboardStore] Clipboard content updated:', {
        type: content.type,
        localClipboardHash: content.localClipboardHash?.substring(0, 8),

        timestamp: content.timestamp,
      });
      set({ currentContent: content });
    });

    await clipboardMonitor.start();

    // 立即触发一次检查，确保 UI 不需要等待第一次轮询 tick
    // （lastContent 为 null 时 hasContentChanged 必返回 true，当前剪贴板内容会立即推送给回调）
    await clipboardMonitor.triggerCheck();
  },

  stopMonitoring: () => {
    if (!get().isMonitoring) {
      return;
    }

    // 后台任务运行时，保持剪贴板监控以支持后台上传，不随 HomeScreen 卸载而停止
    const { useSettingsStore } = require('../stores/settingsStore');
    const config = useSettingsStore.getState().config;
    const bgUploadEnabled = config?.enableBackgroundTasks && config?.enableBackgroundUpload;
    if (bgUploadEnabled) {
      return;
    }

    clipboardMonitor.stop();
    set({ isMonitoring: false });
  },

  updatePollingInterval: (interval: number) => {
    clipboardMonitor.updatePollingInterval(interval);
  },

  setCurrentContentDisplay: (content: ClipboardContent) => {
    set({ currentContent: content });
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    get().stopMonitoring();
    set(initialState);
  },
}));
