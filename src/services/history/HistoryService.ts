/**
 * HistoryService
 * 作为 historyStore 与 HistoryStorage 之间的中间层，封装所有历史记录的 CRUD 操作。
 * 同时承担发布订阅职责：管理所有变更回调，HistoryStorage 不再直接维护订阅者列表。
 */

import type { HistoryItem, ClipboardContent } from '@/types/clipboard';
import type { HistoryFilter, HistorySort } from '@/types/storage';
import type { HistoryChangeCallback } from '@/storage/HistoryStorage';
import { HistorySyncStatus } from '@/types/clipboard';
import { clipboardContentToItem } from '@/utils/clipboard/convert';
import { getHistoryFileUri, prepareHistoryFileUri } from '@/utils/fileStorage';
import { nativeCopyFile } from 'native-util';
import { historyStorage } from '@/storage';

/**
 * HistoryService - 历史记录业务服务
 * 作为 historyStore 和 HistoryStorage 之间的中间层，封装所有历史记录的 CRUD 操作，
 * 并统一管理变更通知的发布订阅。
 */
export class HistoryService {
  private changeCallbacks = new Set<HistoryChangeCallback>();
  private silentMode = false;

  constructor() {
    // 注册为 HistoryStorage 的唯一通知接收方，再由本服务向订阅者分发
    historyStorage.setOnChangeCallback((items, action) => {
      if (this.silentMode) return;
      for (const cb of this.changeCallbacks) {
        try {
          cb(items, action);
        } catch (error) {
          console.error('[HistoryService] Error in change callback:', error);
        }
      }
    });
  }
  // ── CRUD ──────────────────────────────────────────────

  searchItems(
    filter?: HistoryFilter,
    sort?: HistorySort
  ): Promise<{ items: HistoryItem[]; total: number }> {
    return historyStorage.searchItems(filter, sort);
  }

  getItem(profileHash: string): Promise<HistoryItem | null> {
    return historyStorage.getItem(profileHash);
  }

  addItem(item: HistoryItem): Promise<HistoryItem> {
    return historyStorage.addItem(item);
  }

  addRemoteContent(content: ClipboardContent): Promise<HistoryItem> {
    const hasData = content.hasData;
    const fileUri = content.fileUri;

    const historyItem = clipboardContentToItem(content, {
      hasData,
      hasRemoteData: hasData,
      fileUri,
      syncStatus: HistorySyncStatus.Synced,
      isLocalFileReady: !hasData || !!fileUri,
    });

    return historyStorage.addItem(historyItem);
  }

  async addLocalContent(content: ClipboardContent): Promise<HistoryItem> {
    let fileUri: string | undefined;

    if (content.hasData) {
      if (!content.fileName || !content.profileHash) {
        throw new Error(
          '[HistoryService] addLocalContent: fileName and profileHash are required when hasData is true'
        );
      }

      const existingUri = await getHistoryFileUri(
        content.type,
        content.profileHash,
        content.fileName
      );

      if (existingUri) {
        fileUri = existingUri;
      } else if (content.fileUri) {
        const destUri = await prepareHistoryFileUri(
          content.type,
          content.profileHash,
          content.fileName
        );
        await nativeCopyFile(content.fileUri, destUri);
        fileUri = destUri;
      } else {
        throw new Error(
          '[HistoryService] addLocalContent: fileUri is required when hasData is true and file does not exist in history'
        );
      }
    }

    const historyItem = clipboardContentToItem(content, {
      hasData: content.hasData,
      hasRemoteData: false,
      fileUri,
      syncStatus: HistorySyncStatus.LocalOnly,
      isLocalFileReady: !content.hasData || !!fileUri,
    });

    return historyStorage.addItem(historyItem);
  }

  addItems(items: HistoryItem[]): Promise<void> {
    return historyStorage.addItems(items);
  }

  updateItem(profileHash: string, updates: Partial<HistoryItem>): Promise<void> {
    return historyStorage.updateItem(profileHash, updates);
  }

  softDeleteItem(profileHash: string): Promise<void> {
    return historyStorage.softDeleteItem(profileHash);
  }

  softDeleteItems(profileHashes: string[]): Promise<void> {
    return historyStorage.softDeleteItems(profileHashes);
  }

  toggleStar(profileHash: string): Promise<boolean> {
    return historyStorage.toggleStar(profileHash);
  }

  togglePin(profileHash: string): Promise<boolean> {
    return historyStorage.togglePin(profileHash);
  }

  incrementUseCount(profileHash: string): Promise<void> {
    return historyStorage.incrementUseCount(profileHash);
  }

  clear(): Promise<void> {
    return historyStorage.clear().then(() => {
      // 向订阅者发送 clear 事件
      if (!this.silentMode) {
        for (const cb of this.changeCallbacks) {
          try {
            cb([], 'clear');
          } catch (error) {
            console.error('[HistoryService] Error in clear callback:', error);
          }
        }
      }
    });
  }

  setSortConfig(sort: HistorySort): void {
    historyStorage.setSortConfig(sort);
  }

  // ── 发布订阅 ─────────────────────────────────────────

  addChangeCallback(callback: HistoryChangeCallback): void {
    this.changeCallbacks.add(callback);
  }

  removeChangeCallback(callback: HistoryChangeCallback): void {
    this.changeCallbacks.delete(callback);
  }

  /** 进入静默模式：暂停向订阅者分发通知 */
  beginSilentMode(): void {
    this.silentMode = true;
  }

  /** 退出静默模式：恢复通知分发 */
  endSilentMode(): void {
    this.silentMode = false;
  }
}

/** HistoryService 单例 */
export const historyService = new HistoryService();
