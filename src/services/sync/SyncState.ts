/**
 * ClipboardSyncService 的状态类型定义及状态管理单例。
 * 由 ClipboardSyncService 维护，通过发布订阅模式暴露给 ClipboardSyncState (Zustand)。
 */

import type { ClipboardContent } from '../../types/clipboard';
import type { ProgressInfo } from '../../types/progress';

/** ClipboardSyncService 向外暴露的同步状态 */
export interface ClipboardSyncState {
  remoteContent: ClipboardContent | null;
  loadingRemote: boolean;
  downloadingRemote: boolean;
  downloadProgress: ProgressInfo | null;
  uploadingClipboard: boolean;
  fileUploadProgress: ProgressInfo | null;
}

export type ClipboardSyncStateListener = (state: ClipboardSyncState) => void;

class ClipboardSyncStateManager {
  private _state: ClipboardSyncState = {
    remoteContent: null,
    loadingRemote: false,
    downloadingRemote: false,
    downloadProgress: null,
    uploadingClipboard: false,
    fileUploadProgress: null,
  };
  private _listeners = new Set<ClipboardSyncStateListener>();

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
}

export const clipboardSyncState = new ClipboardSyncStateManager();
