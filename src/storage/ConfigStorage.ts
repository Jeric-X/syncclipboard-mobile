/**
 * Config Storage Service
 * 配置存储服务 - 管理应用配置和服务器配置
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppConfig, DEFAULT_APP_CONFIG, STORAGE_KEYS } from '../types/storage';
import { ServerConfig } from '../types/api';
import { migrateAppConfig } from '../utils/configMigration';
import { createStableId } from '../utils/id';
import { ConfigModule, ConfigModuleUpdates, pickModuleUpdates } from '../types/configModules';
import type { NetworkAutoSwitchUpdate } from '../types/networkAutoSwitch';

function createDefaultConfig(): AppConfig {
  return migrateAppConfig(DEFAULT_APP_CONFIG, DEFAULT_APP_CONFIG);
}

/**
 * 配置存储服务
 */
export class ConfigStorage {
  private static instance: ConfigStorage | null = null;
  private config: AppConfig | null = null;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private updates: Promise<void> = Promise.resolve();

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): ConfigStorage {
    if (!ConfigStorage.instance) {
      ConfigStorage.instance = new ConfigStorage();
    }
    return ConfigStorage.instance;
  }

  /**
   * 初始化配置存储
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.initializing) {
      // UI、服务和冷启动 Toast 共用一次读取/迁移，避免并发生成不同的稳定 ID。
      this.initializing = this.loadConfig()
        .catch((error) => {
          console.error('[ConfigStorage] Failed to initialize:', error);
          this.config = createDefaultConfig();
        })
        .then(() => {
          this.initialized = true;
        })
        .finally(() => {
          this.initializing = null;
        });
    }
    await this.initializing;
  }

  /**
   * 加载配置
   */
  private async loadConfig(): Promise<void> {
    const configJson = await AsyncStorage.getItem(STORAGE_KEYS.CONFIG);

    if (configJson) {
      const savedConfig = JSON.parse(configJson);
      this.config = migrateAppConfig(savedConfig, DEFAULT_APP_CONFIG);
      // 迁移生成的稳定 ID 需要立即持久化，确保重启后引用不变化。
      try {
        await this.saveConfig();
      } catch (error) {
        // 已成功读取的配置仍可在本次会话中使用，持久化失败不应回退为默认配置。
        console.warn('[ConfigStorage] Failed to persist migrated config:', error);
      }
    } else {
      this.config = createDefaultConfig();
      await this.saveConfig();
    }
  }

  /**
   * 保存配置
   */
  private async saveConfig(config: AppConfig | null = this.config): Promise<void> {
    if (!config) {
      throw new Error('Config not initialized');
    }

    try {
      await AsyncStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
    } catch (error) {
      console.error('[ConfigStorage] Failed to save config:', error);
      throw error;
    }
  }

  /**
   * 获取完整配置
   */
  public async getConfig(): Promise<AppConfig> {
    if (!this.initialized) {
      await this.initialize();
    }

    return { ...this.config! };
  }

  /**
   * 更新配置
   */
  public async updateConfig(updates: Partial<AppConfig>): Promise<void> {
    await this.updateFields(() => updates);
  }

  /** 只接受所选模块的字段，调用方携带的其他模块快照不会被写入。 */
  public async updateModule<K extends ConfigModule>(
    module: K,
    updates: ConfigModuleUpdates<K>
  ): Promise<void> {
    await this.updateConfig(pickModuleUpdates(module, updates));
  }

  public async updateNetworkAutoSwitch(updates: NetworkAutoSwitchUpdate): Promise<void> {
    await this.updateFields((config) => ({
      networkAutoSwitch: {
        ...config.networkAutoSwitch,
        ...(typeof updates === 'function' ? updates(config.networkAutoSwitch) : updates),
      },
    }));
  }

  /** 写入队列内只生成本操作拥有的字段；失败不污染内存缓存。 */
  private async updateFields(build: (config: AppConfig) => Partial<AppConfig>): Promise<void> {
    await this.writeConfig((config) => ({ ...config, ...build(config) }));
  }

  private async writeConfig(build: (config: AppConfig) => AppConfig): Promise<void> {
    const operation = this.updates
      .catch(() => {})
      .then(async () => {
        await this.initialize();
        const next = build(this.config!);
        await this.saveConfig(next);
        this.config = next;
      });
    this.updates = operation;
    await operation;
  }

  /**
   * 重置配置为默认值
   */
  public async resetConfig(): Promise<void> {
    await this.writeConfig(createDefaultConfig);
  }

  // ========== 服务器配置管理 ==========

  /**
   * 获取所有服务器配置
   */
  public async getServers(): Promise<ServerConfig[]> {
    const config = await this.getConfig();
    return [...config.servers];
  }

  /**
   * 获取当前激活的服务器配置
   */
  public async getActiveServer(): Promise<ServerConfig | null> {
    const config = await this.getConfig();
    if (config.activeServerIndex >= 0 && config.activeServerIndex < config.servers.length) {
      return { ...config.servers[config.activeServerIndex] };
    }
    return null;
  }

  /**
   * 添加服务器配置
   */
  public async addServer(server: ServerConfig): Promise<number> {
    let index = -1;
    await this.updateFields((config) => {
      const usedIds = new Set(config.servers.map((item) => item.id));
      const requestedId = server.id?.trim();
      const id = requestedId && !usedIds.has(requestedId) ? requestedId : createStableId('server');
      const servers = [...config.servers, { ...server, id }];
      index = servers.length - 1;
      return { servers, ...(servers.length === 1 ? { activeServerIndex: 0 } : {}) };
    });
    return index;
  }

  /** 更新指定服务器，保留不可变的 ID；不回写其他模块。 */
  public async updateServer(index: number, updates: Partial<ServerConfig>): Promise<void> {
    await this.updateFields((config) => {
      if (index < 0 || index >= config.servers.length)
        throw new Error(`Invalid server index: ${index}`);
      const servers = [...config.servers];
      const current = servers[index];
      servers[index] = { ...current, ...updates, id: current.id };
      return { servers };
    });
  }

  /** 删除服务器并修复相关引用。 */
  public async deleteServer(index: number): Promise<void> {
    await this.updateFields((config) => {
      if (index < 0 || index >= config.servers.length)
        throw new Error(`Invalid server index: ${index}`);
      const servers = [...config.servers];
      const [deletedServer] = servers.splice(index, 1);
      let activeServerIndex = config.activeServerIndex;
      if (activeServerIndex === index) activeServerIndex = servers.length > 0 ? 0 : -1;
      else if (activeServerIndex > index) activeServerIndex--;
      const patch: Partial<AppConfig> = { servers, activeServerIndex };
      if (deletedServer.id) {
        const autoSwitch = config.networkAutoSwitch;
        const wasDefault = autoSwitch.defaultServerId === deletedServer.id;
        patch.networkAutoSwitch = {
          ...autoSwitch,
          rules: autoSwitch.rules.filter((rule) => rule.targetServerId !== deletedServer.id),
          defaultServerId: wasDefault ? undefined : autoSwitch.defaultServerId,
          noMatchAction: wasDefault ? 'none' : autoSwitch.noMatchAction,
        };
      }
      return patch;
    });
  }

  /** 仅更新当前服务器选择。 */
  public async setActiveServer(index: number): Promise<void> {
    await this.updateFields((config) => {
      if (index < -1 || index >= config.servers.length)
        throw new Error(`Invalid server index: ${index}`);
      return { activeServerIndex: index };
    });
  }

  /** 使用稳定 ID 设置当前服务器；null 表示不使用服务器。 */
  public async setActiveServerById(serverId: string | null): Promise<void> {
    await this.updateFields((config) => {
      const index =
        serverId === null ? -1 : config.servers.findIndex((server) => server.id === serverId);
      if (serverId !== null && index < 0) throw new Error(`Invalid server id: ${serverId}`);
      return { activeServerIndex: index, needsHistoryReorganize: true };
    });
  }

  // ========== 主题管理 ==========

  /**
   * 获取主题设置
   */
  public async getTheme(): Promise<'light' | 'dark' | 'auto'> {
    const config = await this.getConfig();
    return config.theme;
  }

  /**
   * 设置主题
   */
  public async setTheme(theme: 'light' | 'dark' | 'auto'): Promise<void> {
    await this.updateConfig({ theme });
  }

  // ========== 同步设置管理 ==========

  /**
   * 获取同步间隔
   */
  public async getSyncInterval(): Promise<number> {
    const config = await this.getConfig();
    return config.syncInterval;
  }

  /**
   * 设置同步间隔
   */
  public async setSyncInterval(interval: number): Promise<void> {
    if (interval < 1000) {
      throw new Error('Sync interval must be at least 1000ms');
    }
    await this.updateConfig({ syncInterval: interval });
  }

  // ========== 通知设置管理 ==========

  /**
   * 是否启用通知
   */
  public async isNotificationsEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return config.enableNotifications;
  }

  /**
   * 设置通知开关
   */
  public async setNotificationsEnabled(enabled: boolean): Promise<void> {
    await this.updateConfig({ enableNotifications: enabled });
  }

  // ========== 导入/导出 ==========

  /**
   * 导出配置为 JSON
   */
  public async exportConfig(): Promise<string> {
    const config = await this.getConfig();
    return JSON.stringify(config, null, 2);
  }

  /**
   * 从 JSON 导入配置
   */
  public async importConfig(json: string): Promise<void> {
    try {
      const config = JSON.parse(json) as AppConfig;

      // 验证必需字段
      if (!config.servers || !Array.isArray(config.servers)) {
        throw new Error('Invalid config: missing servers array');
      }

      const importedIds = config.servers
        .map((server) => server.id?.trim())
        .filter((id): id is string => !!id);
      if (new Set(importedIds).size !== importedIds.length) {
        throw new Error('Invalid config: duplicate server ids');
      }

      const migrated = migrateAppConfig(config, DEFAULT_APP_CONFIG);
      const validIds = new Set(
        migrated.servers
          .map((server) => server.id)
          .filter((id): id is string => typeof id === 'string')
      );
      const autoSwitch = migrated.networkAutoSwitch;
      if (
        autoSwitch.rules.some((rule) => !validIds.has(rule.targetServerId)) ||
        (autoSwitch.defaultServerId !== undefined && !validIds.has(autoSwitch.defaultServerId))
      ) {
        // 保留失效引用供 UI 提示和修复，但不继承可能错误的当前服务器选择。
        migrated.activeServerIndex = -1;
      }

      // 合并默认配置（确保所有字段都存在）
      await this.writeConfig(() => migrated);
    } catch (error) {
      console.error('[ConfigStorage] Failed to import config:', error);
      throw new Error('Invalid config JSON');
    }
  }

  /**
   * 清空所有配置
   */
  public async clear(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEYS.CONFIG);
    this.config = createDefaultConfig();
    this.initialized = false;
  }
}

// 导出单例
export const configStorage = ConfigStorage.getInstance();
