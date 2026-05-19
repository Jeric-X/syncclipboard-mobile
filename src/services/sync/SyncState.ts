/**
 * ClipboardSyncService 的状态类型定义及状态管理单例。
 * 由 ClipboardSyncService 维护，通过发布订阅模式暴露给 ClipboardSyncState (Zustand)。
 */

import type { ClipboardContent } from '../../types/clipboard';
import type { ProgressDetail } from '../../types/progress';

/** ClipboardSyncService 向外暴露的同步状态 */
export interface ClipboardSyncState {
  remoteContent: ClipboardContent | null;
  loadingRemote: boolean;
  downloadingRemote: boolean;
  downloadProgress: ProgressDetail | null;
  uploadingClipboard: boolean;
  syncError: { title: string; message: string } | null;
}

export type ClipboardSyncStateListener = (state: ClipboardSyncState) => void;

class ClipboardSyncStateManager {
  private _state: ClipboardSyncState = {
    remoteContent: null,
    loadingRemote: false,
    downloadingRemote: false,
    downloadProgress: null,
    uploadingClipboard: false,
    syncError: null,
  };
  private _listeners = new Set<ClipboardSyncStateListener>();
  private _uploadingRefCount = 0;

  /** 获取当前状态快照 */
  getState(): ClipboardSyncState {
    return this._state;
  }

  /** 订阅状态变化，返回取消订阅函数 */
  subscribe(listener: ClipboardSyncStateListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** 更新状态并通知订阅者 */
  setState(patch: Partial<ClipboardSyncState>): void {
    this._state = { ...this._state, ...patch };
    this._listeners.forEach((l) => l(this._state));
  }

  setRemoteContent(content: ClipboardContent | null): void {
    this.setState({ remoteContent: content });
  }

  setLoadingRemote(loading: boolean): void {
    this.setState({ loadingRemote: loading });
  }

  setUploadingClipboard(uploading: boolean): void {
    if (uploading) {
      this._uploadingRefCount++;
    } else {
      this._uploadingRefCount = Math.max(0, this._uploadingRefCount - 1);
    }
    this.setState({ uploadingClipboard: this._uploadingRefCount > 0 });
  }

  setDownloadingRemote(downloading: boolean): void {
    this.setState({ downloadingRemote: downloading });
  }

  setDownloadProgress(progress: ProgressDetail | null): void {
    this.setState({ downloadProgress: progress });
  }

  /** 同时清除 downloadingRemote 和 downloadProgress */
  clearDownloadState(): void {
    this.setState({ downloadingRemote: false, downloadProgress: null });
  }

  /** 在当前 remoteContent 上更新 fileUri；若 remoteContent 为 null 则不操作 */
  updateRemoteContentFileUri(fileUri: string | undefined): void {
    const { remoteContent } = this._state;
    if (!remoteContent) return;
    this.setState({ remoteContent: { ...remoteContent, fileUri } });
  }

  /** 设置同步错误 */
  setSyncError(error: { title: string; message: string } | null): void {
    this.setState({ syncError: error });
  }

  /** 清除同步错误 */
  clearSyncError(): void {
    this.setState({ syncError: null });
  }
}

export const clipboardSyncState = new ClipboardSyncStateManager();
