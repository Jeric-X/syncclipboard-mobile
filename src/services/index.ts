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

// Error Service
export { errorService } from './ErrorService';
export type { ErrorInfo } from './ErrorService';

// Remote Clipboard Sync Service
export { getClipboardSyncService as getClipboardSyncService } from './sync/ClipboardSyncService';

// API client factory – re-exported from the canonical location for backwards compatibility
export { createAPIClient } from '../api/ClientFactory';
