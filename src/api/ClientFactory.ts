/**
 * API Client Factory
 * 统一的 API 客户端工厂函数，替代散落在各处的重复实现。
 *
 * 所有需要创建 ISyncClipboardAPI 的地方均应调用此函数，
 * 避免在 SyncManager、SmsUploadTask、RemoteClipboardMonitor 等处各自维护相同逻辑。
 */

import { SyncClipboardClient } from './clients/SyncClipboardClient';
import { WebDAVClient } from './clients/WebDAVClient';
import { S3Client } from './clients/S3Client';
import { AuthService } from './AuthService';
import { ConfigurationError } from '../errors';
import type { ISyncClipboardAPI } from './clients/APIClient';
import type { ServerConfig } from '../types/api';

/**
 * 根据服务器配置创建对应的 API 客户端实例。
 *
 * - `syncclipboard`：SyncClipboardClient（含可选 Basic Auth）
 * - `s3`：S3Client
 * - 其他（webdav 等）：WebDAVClient
 */
export function createAPIClient(config: ServerConfig): ISyncClipboardAPI {
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
