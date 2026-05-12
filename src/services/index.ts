/**
 * Services Entry Point
 * Exports all API clients and services
 */

// Clipboard Services
export { LocalClipboard, localClipboard } from './clipboard/LocalClipboard';
export { ClipboardMonitor, clipboardMonitor } from './clipboard/ClipboardMonitor';

// SignalR Client (re-exported from signalr-client module)
export { getSignalRClient, resetSignalRClient } from 'signalr-client';
export type {
  SignalRClient,
  RemoteClipboardChangedCallback,
  RemoteHistoryChangedCallback,
} from 'signalr-client';

// Sync Manager
export { SyncManager } from './sync/SyncManager';

// Remote Clipboard Sync Service
export { getClipboardSyncService as getClipboardSyncService } from './sync/ClipboardSyncService';

// Factory function to create appropriate API client
import { SyncClipboardClient } from '../api/clients/SyncClipboardClient';
import { WebDAVClient } from '../api/clients/WebDAVClient';
import { S3Client } from '../api/clients/S3Client';
import { AuthService } from '../api/AuthService';
import { ServerConfig } from '../types/api';
import { ConfigurationError } from '../errors';
import { ISyncClipboardAPI } from '../api/clients/APIClient';

/**
 * 创建 API 客户端工厂函数
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
