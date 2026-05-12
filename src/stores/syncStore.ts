/**
 * Sync Store
 * 同步状态管理 - 使用 Zustand
 */

import { create } from 'zustand';
import {
  SyncDirection,
  SyncResult,
} from '../types/sync';
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

  /** 错误信息 */
  error: string | null;

  // 动作
  /** 初始化同步管理器 */
  initialize: () => Promise<void>;

  /** 执行同步 */
  sync: (direction?: SyncDirection, signal?: AbortSignal) => Promise<SyncResult>;

  /** 销毁 */
  destroy: () => Promise<void>;
}

/**
 * 初始状态
 */
const initialState = {
  manager: null,
  isInitialized: false,
  error: null,
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

    try {
      const manager = SyncManager.getInstance();
      const config = await configStorage.getConfig();

      // 获取激活的服务器配置
      const activeServer = await configStorage.getActiveServer();

      if (!activeServer) {
        set({
          error: 'No active server configured',
          isInitialized: false,
        });
        return;
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
        error: null,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to initialize sync';
      set({ error: errorMessage, isInitialized: false });
    }
  },

  sync: async (direction = SyncDirection.Both, signal?: AbortSignal) => {
    const { manager, isInitialized } = get();

    if (!isInitialized || !manager) {
      const error = 'Sync manager not initialized';
      set({ error });
      return {
        success: false,
        direction,
        error,
      };
    }

    set({ error: null });

    try {
      const result = await manager.sync(direction, false, signal);

      set({
        error: result.success ? null : result.error || 'Sync failed',
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Sync failed';
      set({ error: errorMessage });

      return {
        success: false,
        direction,
        error: errorMessage,
      };
    }
  },

  destroy: async () => {
    const { manager } = get();

    if (manager) {
      await manager.destroy();
    }

    set(initialState);
  },
}));

