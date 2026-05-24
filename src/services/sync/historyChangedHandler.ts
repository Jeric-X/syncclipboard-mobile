import { HistoryItem } from '../../types/clipboard';
import { clipboardSyncState } from './SyncState';
import { useLocalClipboardStore } from '../../stores/localClipboardStore';
import { clipboardMonitor } from '../clipboard/ClipboardMonitor';
import type { HistoryChangeAction } from '../../storage/HistoryStorage';

function resetRemoteFileUriIfMatch(deletedHashes: Set<string>): void {
  const remote = clipboardSyncState.getState().remoteContent;
  if (remote?.profileHash && deletedHashes.has(remote.profileHash.toLowerCase())) {
    console.log(
      '[HistoryChangedHandler] Resetting remote content fileUri, profileHash:',
      remote.profileHash
    );
    clipboardSyncState.updateRemoteContentFileUri(undefined);
  }
}

function resetLocalFileUriIfMatch(deletedHashes: Set<string>): void {
  const local = useLocalClipboardStore.getState().currentContent;
  if (local?.fileUri && local.profileHash && deletedHashes.has(local.profileHash.toLowerCase())) {
    useLocalClipboardStore.getState().setCurrentContentDisplay({ ...local, fileUri: undefined });
    clipboardMonitor.reset();
  }
}

function handleDeletedHashes(deletedHashes: Set<string>): void {
  resetRemoteFileUriIfMatch(deletedHashes);
  resetLocalFileUriIfMatch(deletedHashes);
}

function handleClear(): void {
  console.log('[HistoryChangedHandler] History cleared, resetting fileUris');
  clipboardSyncState.updateRemoteContentFileUri(undefined);
  const local = useLocalClipboardStore.getState().currentContent;
  if (local?.fileUri) {
    useLocalClipboardStore.getState().setCurrentContentDisplay({ ...local, fileUri: undefined });
    clipboardMonitor.reset();
  }
}

export function createHistoryChangedHandler(): (
  items: HistoryItem[],
  action: HistoryChangeAction
) => void {
  return (items: HistoryItem[], action: HistoryChangeAction) => {
    if (action === 'clear') {
      handleClear();
      return;
    }

    if (action === 'delete') {
      const deletedHashes = new Set(items.map((i) => i.profileHash.toLowerCase()));
      handleDeletedHashes(deletedHashes);
      return;
    }

    // 软删除：action 为 'update' 且条目携带 isDeleted: true
    if (action === 'update') {
      const softDeleted = items.filter((i) => i.isDeleted);
      if (softDeleted.length === 0) return;
      const deletedHashes = new Set(softDeleted.map((i) => i.profileHash.toLowerCase()));
      handleDeletedHashes(deletedHashes);
    }
  };
}
