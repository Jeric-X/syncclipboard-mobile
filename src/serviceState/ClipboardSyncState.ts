/**
 * ClipboardSyncState
 * 订阅 clipboardSyncState 单例的状态变化，桥接到 Zustand store 供 React 组件消费。
 */

import { create } from 'zustand';
import { clipboardSyncState, type ClipboardSyncState } from '../services/sync';

export type { ClipboardSyncState } from '../services/sync';

export const useClipboardSyncServiceStore = create<ClipboardSyncState>(() =>
  clipboardSyncState.getState()
);

// 订阅状态变化，同步到 Zustand store
clipboardSyncState.subscribe((state) => {
  useClipboardSyncServiceStore.setState(state);
});
