// 存储层统一导出
export { ConfigStorage, configStorage } from './ConfigStorage';
export { HistoryStorage, historyStorage, type HistoryChangeCallback } from './HistoryStorage';
export { SecureStorage, secureStorage } from './SecureStorage';
export { CacheManager, cacheManager } from './CacheManager';
export {
  getLastSyncHash,
  setLastSyncHash,
  getHistoryLastSyncTime,
  setHistoryLastSyncTime,
  removeHistoryLastSyncTime,
} from './SyncStateStorage';
