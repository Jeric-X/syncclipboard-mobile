/**
 * ClipboardChangedHandler
 * 处理远程和本地剪贴板变化的业务逻辑
 */

import { AppState, Platform, ToastAndroid } from 'react-native';
import { ClipboardContent } from '../../types/clipboard';
import type { AppConfig } from '../../types';
import { clipboardSyncState } from './SyncState';
import { configService } from '../ConfigService';
import { remoteClipboardMonitor } from './RemoteClipboardMonitor';
import { uploadLocalClipboard } from './ClipboardSyncActions';
import { SyncManager } from './SyncManager';
import { historyService } from '../history/HistoryService';
import { calculateTextHash } from '../../utils/hash';
import { getClientService } from '../client/ClientService';

class ClipboardChangedHandler {
  private static instance: ClipboardChangedHandler | null = null;

  private lastRemoteProfileHash: string | null = null;
  private lastLocalProfileHash: string | null = null;

  private constructor() {}

  static getInstance(): ClipboardChangedHandler {
    if (!ClipboardChangedHandler.instance) {
      ClipboardChangedHandler.instance = new ClipboardChangedHandler();
    }
    return ClipboardChangedHandler.instance;
  }

  resetLastRemoteProfileHash(): void {
    this.lastRemoteProfileHash = null;
  }

  resetLastLocalProfileHash(): void {
    this.lastLocalProfileHash = null;
  }

  resetHashes(): void {
    this.lastRemoteProfileHash = null;
    this.lastLocalProfileHash = null;
  }

  setLastLocalProfileHash(hash: string): void {
    this.lastLocalProfileHash = hash;
  }

  async processRemoteClipboardContent(content: ClipboardContent): Promise<void> {
    if (!content.hasData && content.type === 'Text' && !content.profileHash && content.text) {
      content.profileHash = await calculateTextHash(content.text);
    }

    const currentHash = content.profileHash || content.text;
    const config = await configService.getConfig();
    const isFirstLoad = this.lastRemoteProfileHash === null;
    this.lastRemoteProfileHash = currentHash;

    let fileUri: string | undefined;

    if (content.profileHash) {
      const addedItem = await historyService.addRemoteContent(content);
      fileUri = addedItem.fileUri;
    }

    if (fileUri && !content.fileUri) {
      console.log('[ClipboardChangedHandler] Found existing file in history');
      content.fileUri = fileUri;
      clipboardSyncState.setRemoteContent(content);
    } else if (content.hasData && content.fileName && content.fileSize !== undefined) {
      const downloadedContent = await this.tryAutoDownload(content, config);
      if (!downloadedContent) {
        return;
      }
      content = downloadedContent;
    }

    if (isFirstLoad) return;

    await this.tryAutoCopyToClipboard(content, config);
  }

  private async tryAutoDownload(
    content: ClipboardContent,
    config: AppConfig
  ): Promise<ClipboardContent | null> {
    const autoDownloadMaxSize = config?.autoDownloadMaxSize ?? 5 * 1024 * 1024;

    if (content.fileSize! > autoDownloadMaxSize) {
      console.log(
        `[ClipboardChangedHandler] File too large (${content.fileSize} > ${autoDownloadMaxSize}), skipping auto-download`
      );
      return null;
    }

    const result = await this.downloadRemoteFile(content);

    if (result) {
      console.log('[ClipboardChangedHandler] Auto-download completed');
    } else {
      console.error('[ClipboardChangedHandler] Auto-download failed');
    }

    return result;
  }

  private async tryAutoCopyToClipboard(
    content: ClipboardContent,
    config: AppConfig
  ): Promise<void> {
    if (content.type !== 'Text') return;

    const autoSyncEnabled = config?.autoSync ?? false;
    const bgDownloadEnabled = !!(config?.enableBackgroundTasks && config?.enableBackgroundDownload);
    const isAppActive = AppState.currentState === 'active';
    const shouldAutoCopy = autoSyncEnabled || (!isAppActive && bgDownloadEnabled);

    if (!shouldAutoCopy) return;

    const remoteHash = content.profileHash || content.text;
    const localMatchesRemote = remoteHash === this.lastLocalProfileHash;
    const activeServer = await configService.getActiveServer();

    if (localMatchesRemote || !activeServer) {
      return;
    }

    if (!content.text && !content.fileUri) {
      console.log('[ClipboardChangedHandler] No text content available for auto-copy');
      return;
    }

    try {
      const result = await this.copyToLocalClipboard(content);
      if (result.success && Platform.OS === 'android') {
        const preview = this.getContentPreview(content);
        SyncManager.getInstance().updateForegroundNotification(`已下载: ${preview}`);
        if (config?.syncToastEnabled !== false) {
          ToastAndroid.show(`已下载\n${preview}`, ToastAndroid.SHORT);
        }
      }
    } catch (error) {
      console.error('[ClipboardChangedHandler] Auto-copy failed:', error);
    }
  }

  private getContentPreview(content: ClipboardContent): string {
    if (content.type === 'Text' && content.text) {
      return content.text.trim().replace(/\s+/g, ' ').slice(0, 30);
    }
    return content.fileName || content.type;
  }

  private async copyToLocalClipboard(
    content: ClipboardContent
  ): Promise<{ success: boolean; message?: string }> {
    const { copyToLocalClipboard } = await import('../../utils/clipboard');
    const result = await copyToLocalClipboard(content);

    if (result.success) {
      this.lastLocalProfileHash = content.profileHash || content.text;
      console.log('[ClipboardChangedHandler] Copied to local clipboard');
    } else {
      console.error(`[ClipboardChangedHandler] Copy failed: ${result.message}`);
    }
    return result;
  }

  async handleAutoUpload(content: ClipboardContent): Promise<void> {
    const config = await configService.getConfig();

    const autoSync = config?.autoSync ?? false;
    const bgUpload = config?.enableBackgroundTasks && config?.enableBackgroundUpload;
    if (!autoSync && !bgUpload) return;

    const activeServer = await configService.getActiveServer();
    if (!activeServer) return;

    const currentHash = content.profileHash || content.text;

    if (this.lastLocalProfileHash === null) {
      this.lastLocalProfileHash = currentHash;
      return;
    }

    if (currentHash === this.lastLocalProfileHash) return;
    this.lastLocalProfileHash = currentHash;

    try {
      const uploaded = await uploadLocalClipboard(content);
      if (uploaded && Platform.OS === 'android') {
        const preview = this.getContentPreview(content);
        SyncManager.getInstance().updateForegroundNotification(`已上传: ${preview}`);
        if (config?.syncToastEnabled !== false) {
          ToastAndroid.show(`已上传\n${preview}`, ToastAndroid.SHORT);
        }
        remoteClipboardMonitor.refresh().catch(() => {});
      }
    } catch (e: unknown) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        console.error('[ClipboardChangedHandler] Auto-upload failed:', e);
      }
    }
  }

  async downloadRemoteFile(
    content: ClipboardContent,
    progress?: (info: { progress: number; bytesTransferred: number; totalBytes: number }) => void,
    signal?: AbortSignal
  ): Promise<ClipboardContent | null> {
    try {
      const clientService = getClientService();
      return await clientService.downloadData(content, progress, signal);
    } catch (error) {
      const err = error as Error;
      const msg = err?.message?.toLowerCase() ?? '';
      if (err?.name === 'AbortError' || msg.includes('abort') || msg.includes('cancel')) {
        return null;
      }
      console.error('[ClipboardChangedHandler] Download failed:', error);
      return null;
    }
  }
}

export function getClipboardChangedHandler(): ClipboardChangedHandler {
  return ClipboardChangedHandler.getInstance();
}
