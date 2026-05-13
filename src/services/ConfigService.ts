/**
 * ConfigService
 * 配置服务中间层——settingsStore 和 service 层的桥梁。
 *
 * 职责：
 * - 封装 configStorage 的所有读写操作
 * - 提供发布订阅机制，让 service 层订阅配置变化
 * - 变更方法返回最新 AppConfig，避免调用方二次读取
 */

import { configStorage } from '../storage/ConfigStorage';
import type { AppConfig } from '../types/storage';
import type { ServerConfig } from '../types/api';

type ConfigChangeListener = (config: AppConfig) => void;

class ConfigServiceClass {
  private _listeners = new Set<ConfigChangeListener>();

  // ─── 发布订阅 ────────────────────────────────────────────────

  /** 订阅配置变化，返回取消订阅函数 */
  subscribe(listener: ConfigChangeListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _emit(config: AppConfig): void {
    this._listeners.forEach((l) => l(config));
  }

  // ─── 读取 ────────────────────────────────────────────────────

  /** 读取完整配置 */
  async getConfig(): Promise<AppConfig> {
    return configStorage.getConfig();
  }

  /** 获取当前激活的服务器配置 */
  async getActiveServer(): Promise<ServerConfig | null> {
    return configStorage.getActiveServer();
  }

  // ─── 写入（均返回最新 AppConfig 并通知订阅者）────────────────

  /** 更新配置字段 */
  async updateConfig(updates: Partial<AppConfig>): Promise<AppConfig> {
    await configStorage.updateConfig(updates);
    const config = await configStorage.getConfig();
    this._emit(config);
    return config;
  }

  /** 重置为默认配置 */
  async resetConfig(): Promise<AppConfig> {
    await configStorage.resetConfig();
    const config = await configStorage.getConfig();
    this._emit(config);
    return config;
  }

  // ─── 服务器管理 ──────────────────────────────────────────────

  /** 添加服务器 */
  async addServer(server: ServerConfig): Promise<AppConfig> {
    await configStorage.addServer(server);
    const config = await configStorage.getConfig();
    this._emit(config);
    return config;
  }

  /** 更新服务器 */
  async updateServer(index: number, updates: Partial<ServerConfig>): Promise<AppConfig> {
    await configStorage.updateServer(index, updates);
    const config = await configStorage.getConfig();
    this._emit(config);
    return config;
  }

  /** 删除服务器 */
  async deleteServer(index: number): Promise<AppConfig> {
    await configStorage.deleteServer(index);
    const config = await configStorage.getConfig();
    this._emit(config);
    return config;
  }

  /** 设置激活的服务器 */
  async setActiveServer(index: number): Promise<AppConfig> {
    await configStorage.setActiveServer(index);
    const config = await configStorage.getConfig();
    this._emit(config);
    return config;
  }

  // ─── 导入/导出 ───────────────────────────────────────────────

  /** 导出配置为 JSON */
  async exportConfig(): Promise<string> {
    return configStorage.exportConfig();
  }

  /** 从 JSON 导入配置 */
  async importConfig(json: string): Promise<AppConfig> {
    await configStorage.importConfig(json);
    const config = await configStorage.getConfig();
    this._emit(config);
    return config;
  }
}

export const configService = new ConfigServiceClass();
