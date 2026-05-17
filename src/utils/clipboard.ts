/**
 * Clipboard Utilities
 * 剪贴板复制操作工具
 */

import { ClipboardContent } from '@/types';
import { isTextInvalid } from './textUtils';

/**
 * 剪贴板项目复制结果
 */
export interface CopyResult {
  success: boolean;
  message: string;
}

/**
 * 复制剪贴板项目到系统剪贴板
 * @param item 剪贴板项目（可以是 ClipboardContent 或 ClipboardItem）
 * @param clipboardManager 剪贴板管理器实例
 * @returns 复制结果
 */
export async function copyClipboardItem(
  item: {
    type: string;
    text?: string;
    fileUri?: string;
    profileHash?: string;
    hasData: boolean;
  },
  clipboardManager: {
    setClipboardContent: (content: ClipboardContent) => Promise<void>;
    setImageContent: (uri: string) => Promise<void>;
  }
): Promise<CopyResult> {
  try {
    if (item.type === 'Text' && !isTextInvalid(item.text)) {
      await clipboardManager.setClipboardContent({
        type: 'Text',
        text: item.text,
        profileHash: item.profileHash,
        hasData: item.hasData,
      });
      return { success: true, message: '已复制到剪贴板' };
    }

    if (item.type === 'Image' && item.fileUri) {
      await clipboardManager.setImageContent(item.fileUri);
      return { success: true, message: '已复制图片到剪贴板' };
    }

    return { success: false, message: '暂不支持此类型的快速复制' };
  } catch (error) {
    console.error('[copyClipboardItem] Failed to copy:', error);

    // 提取错误信息
    let errorMessage = '复制失败';
    if (error instanceof Error) {
      // 将整个错误转为字符串进行检查（包括多层堆栈）
      const fullErrorString = error.toString() + ' ' + error.message;
      console.log('[copyClipboardItem] Full error string:', fullErrorString);

      if (fullErrorString.includes('TransactionTooLargeException')) {
        errorMessage = '文本内容过大，无法复制到剪贴板（超过系统限制）';
      } else if (fullErrorString.includes('setStringAsync')) {
        // 提取更简洁的错误信息
        errorMessage = '复制失败：' + (error.message || '未知错误');
      } else {
        errorMessage = error.message || '复制失败';
      }
    }

    return { success: false, message: errorMessage };
  }
}

/**
 * 将内容写入系统剪贴板。
 * 只负责复制操作，不更新 Store。
 * 调用者负责在成功后更新 UI 状态。
 */
export async function copyToLocalClipboard(content: ClipboardContent): Promise<CopyResult> {
  const { localClipboard, clipboardMonitor } = await import('@/services');

  clipboardMonitor.pausePolling();
  try {
    let contentToCopy = content;
    if (content.type === 'Text' && content.fileUri && content.hasData) {
      try {
        const response = await fetch(content.fileUri);
        const completeText = await response.text();
        console.log(
          `[copyToLocalClipboard] Read complete text from file for profileHash: ${content.profileHash}, length: ${completeText.length}`
        );
        contentToCopy = {
          ...content,
          text: completeText,
        };
      } catch (error) {
        console.error('[copyToLocalClipboard] Failed to read text file:', error);
        if (isTextInvalid(content.text)) {
          return { success: false, message: '无法读取完整文本' };
        }
      }
    }

    const result = await copyClipboardItem(contentToCopy, localClipboard);
    if (result.success) {
      await clipboardMonitor.setLastContent(contentToCopy);
      const { uselocalClipboardStore } = await import('@/stores/localClipboardStore');
      uselocalClipboardStore.getState().setCurrentContentDisplay(contentToCopy);
    }
    return result;
  } catch (error) {
    console.error('[copyToLocalClipboard] Failed to copy:', error);
    return { success: false, message: '复制失败' };
  } finally {
    clipboardMonitor.resumePolling();
  }
}
