/**
 * HistoryTracker
 * 监听本地剪贴板变化并写入历史记录，无需服务器配置。
 */

import type { ClipboardContent } from '@/types/clipboard';
import { clipboardMonitor } from '../clipboard/ClipboardMonitor';
import { loadLastTrackedHash, saveLastTrackedHash } from './lastTrackedHashStorage';
import { historyService } from './HistoryService';

export class HistoryTracker {
  private _clipboardCallback: ((content: ClipboardContent) => Promise<void>) | null = null;
  private lastTrackedHash: string | null = null;

  /**
   * 开始追踪本地剪贴板内容变化并添加到历史记录。
   * 无需服务器配置，始终可调用，幂等。
   */
  startTracking(): void {
    if (this._clipboardCallback) return;

    // 异步加载持久化 hash，初始化完成前 lastTrackedHash 为 null，
    // 第一次变化会写入历史（HistoryStorage.addItem 幂等去重）
    loadLastTrackedHash()
      .then((hash) => {
        this.lastTrackedHash = hash;
      })
      .catch(() => {});

    const callback = async (content: ClipboardContent): Promise<void> => {
      // hash 去重：与上次记录的 hash 相同则跳过
      const currentHash = content.localClipboardHash ?? content.profileHash ?? null;
      if (currentHash && currentHash === this.lastTrackedHash) return;

      this.lastTrackedHash = currentHash;

      // 持久化 hash
      saveLastTrackedHash(content);

      try {
        await historyService.addLocalContent(content);
      } catch (e) {
        console.error('[HistoryTracker] Failed to add clipboard change to history:', e);
      }
    };

    this._clipboardCallback = callback;
    clipboardMonitor.addCallback(callback);

    console.log('[HistoryTracker] Local clipboard tracking started');
  }

  /**
   * 停止追踪本地剪贴板内容变化。
   */
  stopTracking(): void {
    if (this._clipboardCallback) {
      clipboardMonitor.removeCallback(this._clipboardCallback);
      this._clipboardCallback = null;
      console.log('[HistoryTracker] Local clipboard tracking stopped');
    }
  }
}

// 单例实例
let historyTrackerInstance: HistoryTracker | null = null;

export function getHistoryTracker(): HistoryTracker {
  if (!historyTrackerInstance) {
    historyTrackerInstance = new HistoryTracker();
  }
  return historyTrackerInstance;
}
