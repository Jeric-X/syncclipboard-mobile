/**
 * Common Types & Interfaces
 */

// Export API types
export * from './api';

// Export Clipboard types
export * from './clipboard';

// Export Sync types
export * from './sync';

// Export Storage types
export * from './storage';

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Settings Types (keeping for backward compatibility)
export interface ServerConfig {
  type: 'syncclipboard' | 'builtin' | 'webdav';
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
