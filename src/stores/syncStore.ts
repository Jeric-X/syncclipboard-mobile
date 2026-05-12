/**
 * Sync Store
 * 同步状态管理 - 使用 Zustand
 */

import { create } from 'zustand';
import { SyncManager } from '../services';
import { configStorage } from '../storage';

/**
 * 同步状态接口
 */
interface SyncState {
  // 内部状态
  /** 同步管理器实例 */
  manager: SyncManager | null;

  /** 是否已初始化 */
  isInitialized: boolean;

  // 动作
  /** 初始化同步管理器 */
  initialize: () => Promise<void>;

  /** 销毁 */
  destroy: () => Promise<void>;
}

/**
 * 初始状态
 */
const initialState = {
  manager: null,
  isInitialized: false,
};

/**
 * 创建同步 Store
 */
export const useSyncStore = create<SyncState>((set, get) => ({
  ...initialState,

  initialize: async () => {
    if (get().isInitialized) {
      return;
    }

    const manager = SyncManager.getInstance();
    const config = await configStorage.getConfig();

    // 获取激活的服务器配置
    const activeServer = await configStorage.getActiveServer();

    if (!activeServer) {
      throw new Error('No active server configured');
    }

    // 初始化同步管理器
    await manager.initialize({
      server: activeServer,
      interval: config.syncInterval,
      conflictResolution: config.conflictResolution,
      syncLargeFiles: config.syncLargeFiles,
      largeFileThreshold: config.largeFileThreshold,
      maxRetries: 3,
      retryDelay: 2000,
    });

    set({
      manager,
      isInitialized: true,
    });
  },

  destroy: async () => {
    const { manager } = get();

    if (manager) {
      await manager.destroy();
    }

    set(initialState);
  },
}));
