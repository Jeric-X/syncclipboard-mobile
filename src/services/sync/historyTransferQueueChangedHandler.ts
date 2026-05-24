import { type TransferTask } from '../history/HistoryTransferQueue';
import { clipboardSyncState } from './SyncState';
import { getHistoryFileUri } from '../../utils/fileStorage';
import { configService } from '../ConfigService';
import { getProfileId } from '@/utils';
import { useLocalClipboardStore } from '../../stores/localClipboardStore';

export function createTransferQueueChangedHandler(): (task: TransferTask) => Promise<void> {
  return async (task: TransferTask) => {
    if (task.type === 'upload') {
      await handleUploadTask(task);
      return;
    }

    if (task.type === 'download') {
      await handleDownloadTask(task);
    }
  };
}

async function handleUploadTask(task: TransferTask): Promise<void> {
  const local = useLocalClipboardStore.getState().currentContent;
  if (!local?.profileHash) return;

  const localProfileId = getProfileId(local.type, local.profileHash);
  if (task.profileId !== localProfileId) return;

  if (task.status === 'running' || task.status === 'pending' || task.status === 'waitForRetry') {
    clipboardSyncState.setUploadingClipboard(true);
    if (task.status === 'running' && task.progress >= 0) {
      clipboardSyncState.setUploadProgress({
        progress: task.progress / 100,
        bytesTransferred: task.bytesTransferred,
        totalBytes: task.totalBytes || 0,
      });
    }
  } else {
    clipboardSyncState.setUploadingClipboard(false);
    clipboardSyncState.setUploadProgress(null);
  }
}

async function handleDownloadTask(task: TransferTask): Promise<void> {
  const currentRemote = clipboardSyncState.getState().remoteContent;
  if (!currentRemote?.profileHash) return;

  const profileId = getProfileId(currentRemote.type, currentRemote.profileHash);
  if (task.profileId !== profileId) return;

  if (task.status === 'running' || task.status === 'pending' || task.status === 'waitForRetry') {
    clipboardSyncState.setDownloadingRemote(true);
    if (task.status === 'running' && task.progress >= 0) {
      clipboardSyncState.setDownloadProgress({
        progress: task.progress / 100,
        bytesTransferred: task.bytesTransferred,
        totalBytes: task.totalBytes || 0,
      });
    }
  } else if (task.status === 'completed') {
    if (!currentRemote.fileName || !currentRemote.hasData) {
      clipboardSyncState.clearDownloadState();
      return;
    }
    const fileUri = await getHistoryFileUri(
      currentRemote.type,
      currentRemote.profileHash,
      currentRemote.fileName
    );
    if (fileUri && fileUri !== currentRemote.fileUri) {
      clipboardSyncState.updateRemoteContentFileUri(fileUri);
      const config = await configService.getConfig();
      if (config?.syncToastEnabled !== false) {
        const { ToastAndroid } = require('react-native');
        ToastAndroid.show('文件已下载', ToastAndroid.SHORT);
      }
    }
    clipboardSyncState.clearDownloadState();
  } else {
    clipboardSyncState.clearDownloadState();
  }
}
