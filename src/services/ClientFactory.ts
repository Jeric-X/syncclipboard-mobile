/**
 * Client Factory Service
 * 统一的 API 客户端工厂服务。
 *
 * - 无需传入参数，内部直接读取 configService 的当前激活服务器配置。
 * - 缓存已创建的客户端实例；配置变化时自动清空缓存，下次调用时重新创建。
 */

import { SyncClipboardClient } from '../api/clients/SyncClipboardClient';
import { WebDAVClient } from '../api/clients/WebDAVClient';
import { S3Client } from '../api/clients/S3Client';
import { AuthService } from '../api/AuthService';
import { ConfigurationError } from '../errors';
import type { ISyncClipboardAPI } from '../api/clients/APIClient';
import type { ServerConfig } from '../types/api';
import { configService } from './ConfigService';

// ─── 内部纯工厂函数 ───────────────────────────────────────────────────────────

/**
 * 根据指定的服务器配置创建 API 客户端（同步）。
 * 适用于需要临时测试特定配置（如连接测试）的场景。
 */
export function createClientFromConfig(config: ServerConfig): ISyncClipboardAPI {
  const { type, url, username, password } = config;

  if (type === 'syncclipboard') {
    if (!url) {
      throw new ConfigurationError('Server URL is required');
    }
    const authService = username && password ? new AuthService(username, password) : undefined;
    return new SyncClipboardClient({ baseURL: url, authService });
  }

  if (type === 's3') {
    if (!config.bucketName) {
      throw new ConfigurationError('Bucket name is required for S3');
    }
    if (!username || !password) {
      throw new ConfigurationError('Access Key ID and Secret Access Key are required for S3');
    }
    return new S3Client({
      serviceURL: url || undefined,
      region: config.region,
      bucketName: config.bucketName,
      objectPrefix: config.objectPrefix,
      forcePathStyle: config.forcePathStyle,
      accessKeyId: username,
      secretAccessKey: password,
    });
  }

  // 非 SyncClipboard/S3 服务器，使用 WebDAV 客户端
  if (!url) {
    throw new ConfigurationError('Server URL is required');
  }
  if (!username || !password) {
    throw new ConfigurationError('Username and password are required for WebDAV');
  }
  return new WebDAVClient({ baseURL: url, username, password });
}

// ─── 缓存 ─────────────────────────────────────────────────────────────────────

let _cachedClient: ISyncClipboardAPI | null = null;
let _cachedServerKey: string | null = null;

// 仅当激活服务器配置发生变化时清空缓存（忽略其他字段变更）
configService.subscribe((config) => {
  const activeServer = (config.servers ?? [])[config.activeServerIndex] ?? null;
  const newKey = activeServer ? JSON.stringify(activeServer) : null;
  if (newKey !== _cachedServerKey) {
    _cachedClient = null;
    _cachedServerKey = null;
  }
});

// ─── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 获取当前激活服务器的 API 客户端（带缓存）。
 * 仅当激活服务器配置变化后才重新创建实例。
 */
export async function getAPIClient(): Promise<ISyncClipboardAPI> {
  if (_cachedClient) return _cachedClient;

  const server = await configService.getActiveServer();
  if (!server) {
    throw new ConfigurationError('No active server configured');
  }
  _cachedClient = createClientFromConfig(server);
  _cachedServerKey = JSON.stringify(server);
  return _cachedClient;
}
