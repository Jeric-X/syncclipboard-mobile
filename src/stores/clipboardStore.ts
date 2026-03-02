/**
 * Clipboard Store
 * 剪贴板状态管理 - 使用 Zustand
 */

import { create } from 'zustand';
import { ClipboardContent, ClipboardItem } from '../types/clipboard';
import { clipboardManager, clipboardMonitor } from '../services';
import { useHistoryStore } from './historyStore';

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

  /** 设置剪贴板内容 */
  setContent: (content: ClipboardContent) => Promise<void>;

  /** 从图库选择图片 */
  pickImage: () => Promise<void>;

  /** 拍照 */
  takePhoto: () => Promise<void>;

  /** 开始监听剪贴板 */
  startMonitoring: () => void;

  /** 停止监听剪贴板 */
  stopMonitoring: () => void;

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
      const content = await clipboardManager.getClipboardContent();

      // 如果内容未变化（localClipboardHash 相同），跳过状态更新，避免 Image 组件因
      // key 中的 timestamp 变化而重新挂载导致闪烁（切换前后台场景）
      const currentContent = get().currentContent;
      if (
        content &&
        currentContent &&
        content.localClipboardHash &&
        currentContent.localClipboardHash &&
        content.localClipboardHash === currentContent.localClipboardHash
      ) {
        set({ isLoading: false });
        return;
      }

      set({ currentContent: content, isLoading: false });

      // 添加到历史记录
      if (content) {
        const historyItem: ClipboardItem = {
          type: content.type,
          text: content.text || '',
          profileHash: content.profileHash || '',
          hasData: !!(content.fileName || content.fileUri),
          dataName: content.fileName,
          size: content.fileSize,
          timestamp: content.timestamp || Date.now(),
          synced: false,
          fileUri: content.fileUri,
        };
        await useHistoryStore.getState().addItem(historyItem);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to get clipboard content';
      set({ error: errorMessage, isLoading: false });
    }
  },

  setContent: async (content: ClipboardContent) => {
    set({ isLoading: true, error: null });

    try {
      await clipboardManager.setClipboardContent(content);

      console.log(
        `[clipboardManager] new content set: type=${content.type}, text=${content.text?.substring(0, 20)}, profileHash=${content.profileHash?.substring(0, 8)}, timestamp=${content.timestamp}`
      );
      set({ currentContent: content, isLoading: false });

      // 添加到历史记录
      const historyItem: ClipboardItem = {
        type: content.type,
        text: content.text || '',
        profileHash: content.profileHash || '',
        hasData: !!(content.fileName || content.fileUri),
        dataName: content.fileName,
        size: content.fileSize,
        timestamp: content.timestamp || Date.now(),
        synced: false,
        fileUri: content.fileUri,
      };
      await useHistoryStore.getState().addItem(historyItem);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to set clipboard content';
      set({ error: errorMessage, isLoading: false });
    }
  },

  pickImage: async () => {
    set({ isLoading: true, error: null });

    try {
      const content = await clipboardManager.pickImageFromGallery();
      if (content) {
        set({ currentContent: content, isLoading: false });

        // 添加到历史记录
        const historyItem: ClipboardItem = {
          type: content.type,
          text: content.text || '',
          profileHash: content.profileHash || '',
          hasData: !!(content.fileName || content.fileUri),
          dataName: content.fileName,
          size: content.fileSize,
          timestamp: content.timestamp || Date.now(),
          synced: false,
        };
        await useHistoryStore.getState().addItem(historyItem);
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to pick image';
      set({ error: errorMessage, isLoading: false });
    }
  },

  takePhoto: async () => {
    set({ isLoading: true, error: null });

    try {
      const content = await clipboardManager.takePhoto();
      if (content) {
        set({ currentContent: content, isLoading: false });

        // 添加到历史记录
        const historyItem: ClipboardItem = {
          type: content.type,
          text: content.text || '',
          profileHash: content.profileHash || '',
          hasData: !!(content.fileName || content.fileUri),
          dataName: content.fileName,
          size: content.fileSize,
          timestamp: content.timestamp || Date.now(),
          synced: false,
        };
        await useHistoryStore.getState().addItem(historyItem);
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to take photo';
      set({ error: errorMessage, isLoading: false });
    }
  },

  startMonitoring: () => {
    if (get().isMonitoring) {
      return;
    }

    clipboardMonitor.addCallback(async (content) => {
      console.log('[ClipboardStore] Clipboard content updated:', {
        type: content.type,
        localClipboardHash: content.localClipboardHash?.substring(0, 8),

        timestamp: content.timestamp,
      });
      set({ currentContent: content });

      // 添加到历史记录
      const historyItem: ClipboardItem = {
        type: content.type,
        text: content.text || '',
        profileHash: content.profileHash || '',
        hasData: !!(content.fileName || content.fileUri),
        dataName: content.fileName,
        size: content.fileSize,
        timestamp: content.timestamp || Date.now(),
        synced: false,
        fileUri: content.fileUri,
      };
      await useHistoryStore.getState().addItem(historyItem);
    });

    clipboardMonitor.start();
    set({ isMonitoring: true });
  },

  stopMonitoring: () => {
    if (!get().isMonitoring) {
      return;
    }

    clipboardMonitor.stop();
    set({ isMonitoring: false });
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
