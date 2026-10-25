/**
 * SyncStateStorage
 * 管理当前剪贴板同步 hash 的 AsyncStorage 持久化访问。
 *
 * 历史记录同步游标由 HistoryDatabase 与历史记录一起持久化。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../types/storage';

// ─── SyncManager: last uploaded profile hash ────────────────────────────────

/**
 * 读取 SyncManager 上次成功上传的 profileHash。
 * 首次返回 null（未持久化）。
 */
export async function getLastSyncHash(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEYS.SYNC_LAST_HASH);
  } catch (error) {
    console.error('[SyncStateStorage] Failed to read last sync hash:', error);
    return null;
  }
}

/**
 * 持久化 SyncManager 上次成功上传的 profileHash。
 */
export async function setLastSyncHash(hash: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.SYNC_LAST_HASH, hash);
  } catch (error) {
    console.error('[SyncStateStorage] Failed to write last sync hash:', error);
  }
}
