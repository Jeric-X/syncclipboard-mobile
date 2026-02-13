/**
 * Services Entry Point
 * Exports all API clients and services
 */

// Error classes
export * from './errors';

// Authentication
export { AuthService, type Credentials } from './AuthService';

// API Clients
export { APIClient, type APIClientConfig } from './APIClient';
export { SyncClipboardAPI, type ISyncClipboardAPI } from './SyncClipboardAPI';
export { WebDAVClient, type WebDAVConfig } from './WebDAVClient';

// Clipboard Services
export { ClipboardManager, clipboardManager } from './ClipboardManager';
export { ClipboardMonitor, clipboardMonitor } from './ClipboardMonitor';

// SignalR Client
export { SignalRClient, getSignalRClient, resetSignalRClient } from './SignalRClient';
export type { RemoteClipboardChangedCallback, RemoteHistoryChangedCallback } from './SignalRClient';

// Sync Manager
export { SyncManager } from './SyncManager';

// Storage Services
export { ConfigStorage, configStorage } from './ConfigStorage';
export { HistoryStorage, historyStorage } from './HistoryStorage';
export { CacheManager, cacheManager } from './CacheManager';
export { SecureStorage, secureStorage } from './SecureStorage';

// Factory function to create appropriate API client
import { SyncClipboardAPI } from './SyncClipboardAPI';
import { WebDAVClient } from './WebDAVClient';
import { AuthService } from './AuthService';
import { ServerConfig } from '../types/api';
import { ConfigurationError } from './errors';

/**
 * 创建 API 客户端工厂函数
 */
export function createAPIClient(config: ServerConfig): SyncClipboardAPI | WebDAVClient {
  const { type, url, username, password } = config;

  if (!url) {
    throw new ConfigurationError('Server URL is required');
  }

  if (type === 'webdav') {
    if (!username || !password) {
      throw new ConfigurationError('Username and password are required for WebDAV');
    }
    return new WebDAVClient({ baseURL: url, username, password });
  }

  if (type === 'syncclipboard') {
    const authService = username && password ? new AuthService(username, password) : undefined;

    return new SyncClipboardAPI({ baseURL: url, authService });
  }

  throw new ConfigurationError(`Unsupported server type: ${type}`);
}
