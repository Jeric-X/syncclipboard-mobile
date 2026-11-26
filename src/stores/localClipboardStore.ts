/**
 * Clipboard Store
 * 剪贴板状态管理 - 使用 Zustand
 */

import { create } from 'zustand';
import { ClipboardContent } from '../types/clipboard';
import { clipboardMonitor } from '../services/clipboard/ClipboardMonitor';

/**
 * 剪贴板状态接口
 */
interface ClipboardState {
  // 状态
  /** 当前剪贴板内容 */
  currentContent: ClipboardContent | null;

  // 动作
  /** 仅更新本地剪贴板卡片显示，不写系统剪贴板、不添加历史记录 */
  setCurrentContentDisplay: (content: ClipboardContent) => void;
}

/**
 * 创建剪贴板 Store
 */
export const useLocalClipboardStore = create<ClipboardState>((set) => ({
  currentContent: null,

  setCurrentContentDisplay: (content: ClipboardContent) => {
    set({ currentContent: content });
  },
}));

// 注册 callback：将剪贴板变化同步到 localClipboardStore
clipboardMonitor.addCallback((content) => {
  useLocalClipboardStore.getState().setCurrentContentDisplay(content);
});
