/**
 * Common Types & Interfaces
 */

// Export API types
export * from './api';

// Export Clipboard types
export * from './clipboard';

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Clipboard Types
export enum ClipboardType {
  Text = 0,
  Image = 1,
  File = 2,
  Group = 3,
}

export interface ClipboardItem {
  id: string;
  type: ClipboardType;
  content: string;
  hash: string;
  timestamp: number;
  deviceName?: string;
}

// Settings Types (keeping for backward compatibility)
export interface ServerConfig {
  type: 'standalone' | 'builtin' | 'webdav';
  url: string;
  username?: string;
  password?: string;
}

export interface AppSettings {
  server: ServerConfig;
  autoSync: boolean;
  syncInterval: number;
  maxHistorySize: number;
  theme: 'light' | 'dark' | 'auto';
}
