/**
 * SyncStateStorage
 * 集中管理同步相关的 AsyncStorage 持久化访问。
 *
 * 此前 AsyncStorage 的 @syncclipboard:sync:last_hash 和
 * @syncclipboard:history:last_sync_time 分散在 SyncManager、HistorySyncService 中，
 * 现统一至此模块，key 常量引用 STORAGE_KEYS 避免字符串字面量漂移。
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

// ─── HistorySyncService: last full-sync timestamp ────────────────────────────

/**
 * 读取 HistorySyncService 上次完整同步时间戳（毫秒）。
 * 首次返回 null。
 */
export async function getHistoryLastSyncTime(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.HISTORY_LAST_SYNC_TIME);
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    console.warn('[SyncStateStorage] Failed to read history last sync time:', error);
    return null;
  }
}

/**
 * 持久化 HistorySyncService 上次完整同步时间戳（毫秒）。
 */
export async function setHistoryLastSyncTime(timeMs: number): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.HISTORY_LAST_SYNC_TIME, timeMs.toString());
  } catch (error) {
    console.warn('[SyncStateStorage] Failed to write history last sync time:', error);
  }
}

/**
 * 删除 HistorySyncService 上次完整同步时间（重置状态）。
 */
export async function removeHistoryLastSyncTime(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEYS.HISTORY_LAST_SYNC_TIME);
  } catch (error) {
    console.warn('[SyncStateStorage] Failed to remove history last sync time:', error);
  }
}
