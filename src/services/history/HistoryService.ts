/**
 * HistoryService
 * 本地历史记录服务 - 监听本地剪贴板变化并写入历史记录，无需服务器配置。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ClipboardContent } from '@/types/clipboard';

const LAST_CLIPBOARD_HASH_KEY = '@last_clipboard_hash';

export class HistoryService {
  private localClipboardStoreUnsub: (() => void) | null = null;
  private lastTrackedHash: string | null = null;

  /**
   * 开始追踪本地剪贴板内容变化并添加到历史记录。
   * 无需服务器配置，始终可调用，幂等。
   */
  startTracking(): void {
    if (this.localClipboardStoreUnsub) return;

    // 异步加载持久化 hash，初始化完成前 lastTrackedHash 为 null，
    // 第一次变化会写入历史（HistoryStorage.addItem 幂等去重）
    AsyncStorage.getItem(LAST_CLIPBOARD_HASH_KEY)
      .then((stored) => {
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as {
              localClipboardHash?: string;
              profileHash?: string;
            };
            this.lastTrackedHash = parsed.localClipboardHash ?? parsed.profileHash ?? null;
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {});

    const { uselocalClipboardStore } = require('../../stores/localClipboardStore');
    const { clipboardContentToItem } = require('../../utils/clipboard/dtoConvert');
    const { useHistoryStore } = require('../../stores/historyStore');

    this.localClipboardStoreUnsub = uselocalClipboardStore.subscribe(
      (state: { currentContent: ClipboardContent | null }) => state.currentContent,
      async (content: ClipboardContent | null) => {
        if (!content) return;

        // hash 去重：与上次记录的 hash 相同则跳过
        const currentHash = content.localClipboardHash ?? content.profileHash ?? null;
        if (currentHash && currentHash === this.lastTrackedHash) return;

        this.lastTrackedHash = currentHash;

        // 持久化 hash
        if (currentHash) {
          AsyncStorage.setItem(
            LAST_CLIPBOARD_HASH_KEY,
            JSON.stringify({
              localClipboardHash: content.localClipboardHash,
              profileHash: content.profileHash,
              type: content.type,
            })
          ).catch(() => {});
        }

        try {
          const historyItem = clipboardContentToItem(content);
          await useHistoryStore.getState().addItem(historyItem);
        } catch (e) {
          console.error('[HistoryService] Failed to add clipboard change to history:', e);
        }
      }
    );

    console.log('[HistoryService] Local clipboard tracking started');
  }

  /**
   * 停止追踪本地剪贴板内容变化。
   */
  stopTracking(): void {
    if (this.localClipboardStoreUnsub) {
      this.localClipboardStoreUnsub();
      this.localClipboardStoreUnsub = null;
      console.log('[HistoryService] Local clipboard tracking stopped');
    }
  }
}

// 单例实例
let historyServiceInstance: HistoryService | null = null;

export function getHistoryService(): HistoryService {
  if (!historyServiceInstance) {
    historyServiceInstance = new HistoryService();
  }
  return historyServiceInstance;
}
