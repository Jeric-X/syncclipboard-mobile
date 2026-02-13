/**
 * Settings Store
 * 设置状态管理 - 使用 Zustand
 */

import { create } from 'zustand';
import { AppConfig } from '../types/storage';
import { ServerConfig } from '../types/api';
import { configStorage } from '../services';

/**
 * 设置状态接口
 */
interface SettingsState {
  // 状态
  /** 应用配置 */
  config: AppConfig | null;

  /** 是否已加载 */
  isLoaded: boolean;

  /** 是否正在保存 */
  isSaving: boolean;

  /** 错误信息 */
  error: string | null;

  // 动作
  /** 加载配置 */
  loadConfig: () => Promise<void>;

  /** 更新配置 */
  updateConfig: (updates: Partial<AppConfig>) => Promise<void>;

  /** 重置配置 */
  resetConfig: () => Promise<void>;

  // 服务器管理
  /** 获取服务器列表 */
  getServers: () => ServerConfig[];

  /** 获取当前服务器 */
  getActiveServer: () => ServerConfig | null;

  /** 添加服务器 */
  addServer: (server: ServerConfig) => Promise<void>;

  /** 更新服务器 */
  updateServer: (index: number, updates: Partial<ServerConfig>) => Promise<void>;

  /** 删除服务器 */
  deleteServer: (index: number) => Promise<void>;

  /** 设置激活服务器 */
  setActiveServer: (index: number) => Promise<void>;

  // 主题设置
  /** 获取主题 */
  getTheme: () => 'light' | 'dark' | 'auto';

  /** 设置主题 */
  setTheme: (theme: 'light' | 'dark' | 'auto') => Promise<void>;

  // 同步设置
  /** 设置同步模式 */
  setSyncMode: (mode: string) => Promise<void>;

  /** 设置同步间隔 */
  setSyncInterval: (interval: number) => Promise<void>;

  /** 设置冲突解决策略 */
  setConflictResolution: (strategy: string) => Promise<void>;

  /** 设置离线队列 */
  setOfflineQueue: (enabled: boolean) => Promise<void>;

  /** 设置大文件同步 */
  setLargeFileSync: (enabled: boolean, threshold?: number) => Promise<void>;

  // 通知设置
  /** 设置通知 */
  setNotifications: (enabled: boolean) => Promise<void>;

  /** 设置后台同步 */
  setSyncInBackground: (enabled: boolean) => Promise<void>;

  /** 设置启动时同步 */
  setSyncOnStartup: (enabled: boolean) => Promise<void>;

  /** 设置自动同步 */
  setAutoSync: (enabled: boolean) => Promise<void>;

  /** 设置自动下载最大文件大小（字节） */
  setAutoDownloadMaxSize: (sizeInBytes: number) => Promise<void>;

  // 导入/导出
  /** 导出配置 */
  exportConfig: () => Promise<string>;

  /** 导入配置 */
  importConfig: (json: string) => Promise<void>;

  /** 清除错误 */
  clearError: () => void;
}

/**
 * 初始状态
 */
const initialState = {
  config: null,
  isLoaded: false,
  isSaving: false,
  error: null,
};

/**
 * 创建设置 Store
 */
export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initialState,

  loadConfig: async () => {
    try {
      const config = await configStorage.getConfig();
      set({ config, isLoaded: true, error: null });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load config';
      set({ error: errorMessage, isLoaded: false });
    }
  },

  updateConfig: async (updates: Partial<AppConfig>) => {
    set({ isSaving: true, error: null });

    try {
      await configStorage.updateConfig(updates);
      const config = await configStorage.getConfig();
      set({ config, isSaving: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update config';
      set({ error: errorMessage, isSaving: false });
    }
  },

  resetConfig: async () => {
    set({ isSaving: true, error: null });

    try {
      await configStorage.resetConfig();
      const config = await configStorage.getConfig();
      set({ config, isSaving: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to reset config';
      set({ error: errorMessage, isSaving: false });
    }
  },

  getServers: () => {
    const { config } = get();
    return config?.servers || [];
  },

  getActiveServer: () => {
    const { config } = get();
    if (!config || config.activeServerIndex < 0) {
      return null;
    }
    return config.servers[config.activeServerIndex] || null;
  },

  addServer: async (server: ServerConfig) => {
    set({ isSaving: true, error: null });

    try {
      await configStorage.addServer(server);
      const config = await configStorage.getConfig();
      set({ config, isSaving: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to add server';
      set({ error: errorMessage, isSaving: false });
    }
  },

  updateServer: async (index: number, updates: Partial<ServerConfig>) => {
    set({ isSaving: true, error: null });

    try {
      await configStorage.updateServer(index, updates);
      const config = await configStorage.getConfig();
      set({ config, isSaving: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update server';
      set({ error: errorMessage, isSaving: false });
    }
  },

  deleteServer: async (index: number) => {
    set({ isSaving: true, error: null });

    try {
      await configStorage.deleteServer(index);
      const config = await configStorage.getConfig();
      set({ config, isSaving: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete server';
      set({ error: errorMessage, isSaving: false });
    }
  },

  setActiveServer: async (index: number) => {
    set({ isSaving: true, error: null });

    try {
      await configStorage.setActiveServer(index);
      const config = await configStorage.getConfig();
      set({ config, isSaving: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to set active server';
      set({ error: errorMessage, isSaving: false });
    }
  },

  getTheme: () => {
    const { config } = get();
    return config?.theme || 'auto';
  },

  setTheme: async (theme: 'light' | 'dark' | 'auto') => {
    await get().updateConfig({ theme });
  },

  setSyncMode: async (mode: string) => {
    await get().updateConfig({ syncMode: mode as any });
  },

  setSyncInterval: async (interval: number) => {
    await get().updateConfig({ syncInterval: interval });
  },

  setConflictResolution: async (strategy: string) => {
    await get().updateConfig({ conflictResolution: strategy as any });
  },

  setOfflineQueue: async (enabled: boolean) => {
    await get().updateConfig({ enableOfflineQueue: enabled });
  },

  setLargeFileSync: async (enabled: boolean, threshold?: number) => {
    const updates: Partial<AppConfig> = { syncLargeFiles: enabled };
    if (threshold !== undefined) {
      updates.largeFileThreshold = threshold;
    }
    await get().updateConfig(updates);
  },

  setNotifications: async (enabled: boolean) => {
    await get().updateConfig({ enableNotifications: enabled });
  },

  setSyncInBackground: async (enabled: boolean) => {
    await get().updateConfig({ syncInBackground: enabled });
  },

  setSyncOnStartup: async (enabled: boolean) => {
    await get().updateConfig({ syncOnStartup: enabled });
  },

  setAutoSync: async (enabled: boolean) => {
    await get().updateConfig({ autoSync: enabled });
  },

  setAutoDownloadMaxSize: async (sizeInBytes: number) => {
    await get().updateConfig({ autoDownloadMaxSize: sizeInBytes });
  },

  exportConfig: async () => {
    try {
      return await configStorage.exportConfig();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to export config';
      set({ error: errorMessage });
      throw error;
    }
  },

  importConfig: async (json: string) => {
    set({ isSaving: true, error: null });

    try {
      await configStorage.importConfig(json);
      const config = await configStorage.getConfig();
      set({ config, isSaving: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to import config';
      set({ error: errorMessage, isSaving: false });
      throw error;
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));
