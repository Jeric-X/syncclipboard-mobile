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
import { uploadLocalClipboard, downloadRemoteClipboard } from './ClipboardSyncActions';
import { updateForegroundNotification } from '../notification/ForegroundNotification';
import { historyService } from '../history/HistoryService';
import { calculateTextHash } from '../../utils/hash';

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
    clipboardSyncState.setRemoteContent(content);

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
      content = { ...content, fileUri };
    } else if (content.hasData && content.fileName && content.fileSize !== undefined) {
      const downloadedContent = await this.tryAutoDownload(content, config);
      if (!downloadedContent) {
        return;
      }
      content = downloadedContent;
    }

    clipboardSyncState.setRemoteContent(content);

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

    try {
      const result = await downloadRemoteClipboard(content);
      console.log('[ClipboardChangedHandler] Auto-download completed');
      return result;
    } catch (error) {
      const err = error as Error;
      if (err?.name !== 'AbortError') {
        console.error('[ClipboardChangedHandler] Auto-download failed:', error);
      }
      return null;
    }
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
      await this.copyToLocalClipboard(content);
      if (Platform.OS === 'android') {
        const preview = this.getContentPreview(content);
        updateForegroundNotification(`已下载: ${preview}`);
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

  private async copyToLocalClipboard(content: ClipboardContent): Promise<void> {
    const { localClipboard } = await import('../clipboard/LocalClipboard');
    await localClipboard.setClipboardContent(content, true);
    this.lastLocalProfileHash = content.profileHash || content.text;
    console.log('[ClipboardChangedHandler] Copied to local clipboard');
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
        updateForegroundNotification(`已上传: ${preview}`);
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
}

export function getClipboardChangedHandler(): ClipboardChangedHandler {
  return ClipboardChangedHandler.getInstance();
}
