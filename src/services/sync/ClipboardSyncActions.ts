import type { ClipboardContent } from '@/types/clipboard';
import type { ProgressInfo } from '@/types/progress';
import type { ProgressDetail } from '@/types/progress';
import { historyService } from '../history/HistoryService';
import { getClientService } from '../client/ClientService';
import { configService } from '../ConfigService';
import { remoteClipboardMonitor } from './RemoteClipboardMonitor';
import { clipboardSyncState } from './SyncState';
import { clipboardMonitor } from '../clipboard/ClipboardMonitor';
import { localClipboard } from '../clipboard/LocalClipboard';
import { DedupedOperation } from '@/utils/DedupedOperation';
import { File } from 'expo-file-system';

/** 比较两个 ClipboardContent 是否代表相同内容（用于去重继承判断） */
function isSameContent(a: ClipboardContent, b: ClipboardContent): boolean {
  if (a.type !== b.type) return false;
  if (a.profileHash && b.profileHash) return a.profileHash === b.profileHash;
  if (a.type === 'Text') return a.text === b.text;
  return a.fileName === b.fileName && a.fileSize === b.fileSize;
}

const _uploadOp = new DedupedOperation<ClipboardContent, boolean, ProgressInfo>(isSameContent);
const _downloadOp = new DedupedOperation<ClipboardContent, ClipboardContent | null, ProgressDetail>(
  isSameContent
);

/**
 * 上传文件到远程剪贴板，并将内容添加到本地历史记录。
 * - 若与正在进行的上传内容相同，则继承（共享进度），等待完成。
 * - 若不同，则取消正在进行的上传并重新开始。
 * @param content 已构建好的剪贴板内容（含 profileHash、fileUri 等）
 * @param signal 外部取消信号
 * @param onProgress 上传进度回调
 * @returns `true` 表示上传已完成
 * @throws 当被取消（AbortError）或发生其他错误时抛出
 */
export async function setRemoteClipboard(
  content: ClipboardContent,
  signal: AbortSignal,
  onProgress?: (info: ProgressInfo) => void
): Promise<boolean> {
  return _uploadOp.execute(content, onProgress, signal, async (sig, notify) => {
    if (sig.aborted) throw new DOMException('Aborted', 'AbortError');

    const server = await configService.getActiveServer();
    if (!server) throw new Error('请先在设置中配置服务器');

    await historyService.addLocalContent(content);

    await getClientService().setRemoteClipboard(content, notify, sig);

    if (content.profileHash) {
      remoteClipboardMonitor.setLastContentHash(content.profileHash);
    }
    return true;
  });
}

/**
 * 上传内容到远程剪贴板，并同步更新本地剪贴板卡片的上传状态（uploadingClipboard）。
 * @param content 剪贴板内容；为 null/undefined 时自动从本地剪贴板读取
 * @returns `true` 表示上传已完成，`false` 表示无内容可上传
 */
export async function uploadLocalClipboard(content?: ClipboardContent | null): Promise<boolean> {
  const actualContent = content ?? clipboardMonitor.getLastContent();
  if (!actualContent) return false;
  const controller = new AbortController();
  clipboardSyncState.setUploadingClipboard(true);
  clipboardSyncState.setUploadProgress(null);
  try {
    return await setRemoteClipboard(actualContent, controller.signal, (info) => {
      clipboardSyncState.setUploadProgress(info);
    });
  } finally {
    clipboardSyncState.setUploadingClipboard(false);
    clipboardSyncState.setUploadProgress(null);
  }
}

/** 取消当前正在进行的本地上传（如有） */
export function cancelUploadLocalClipboard(): void {
  _uploadOp.abort();
}

/**
 * 下载远程剪贴板文件，并同步更新 UI 下载进度状态（downloadingRemote / downloadProgress）。
 * - 若与正在进行的下载内容相同，则继承（共享进度），等待完成。
 * - 若不同，则取消正在进行的下载并重新开始。
 * @param content 远程剪贴板内容；为 null/undefined 时自动从当前远程剪贴板状态读取
 * @returns 下载完成的内容；若 content 和当前远程状态均为空则返回 null
 * @throws 下载失败或被取消时抛出异常
 */
export async function downloadRemoteClipboard(
  content?: ClipboardContent | null,
  onProgress?: (info: ProgressDetail) => void,
  signal?: AbortSignal
): Promise<ClipboardContent | null> {
  const actualContent = content ?? clipboardSyncState.getState().remoteContent;
  if (!actualContent) return null;

  return _downloadOp.execute(actualContent, onProgress, signal ?? null, async (sig, notify) => {
    clipboardSyncState.setDownloadingRemote(true);
    clipboardSyncState.setDownloadProgress(null);
    try {
      const result = await getClientService().downloadData(
        actualContent,
        (info: ProgressDetail) => {
          clipboardSyncState.setDownloadProgress(info);
          notify(info);
        },
        sig
      );
      clipboardSyncState.setState({ remoteContent: result });
      return result;
    } finally {
      clipboardSyncState.clearDownloadState();
    }
  });
}

/**
 * 取消正在进行的远程剪贴板文件下载。
 */
export function cancelRemoteClipboardDownload(): void {
  _downloadOp.abort();
}

/**
 * 刷新本地剪贴板和远程剪贴板监视器。
 * 等价于原 ClipboardSyncService.refreshContent()。
 */
export async function refreshMonitor(): Promise<void> {
  await clipboardMonitor.triggerCheck();
  await remoteClipboardMonitor.refresh();
}

/**
 * 拉取最新远程剪贴板内容，若包含未下载的文件则先下载，最后写入本地剪贴板。
 * @returns 最终写入的内容；若远程无文件或无需下载则返回 fetchLatest 的结果
 */
export async function setLocalClipboardFromRemote(
  onProgress?: (info: ProgressDetail) => void,
  signal?: AbortSignal
): Promise<ClipboardContent | null> {
  const content = await remoteClipboardMonitor.fetchLatest();

  const needsDownload =
    content.hasData &&
    content.fileName !== undefined &&
    content.fileSize !== undefined &&
    !content.fileUri;

  if (needsDownload && content.profileHash) {
    const cachedItem = await historyService.getItem(content.profileHash);
    if (cachedItem?.fileUri) {
      const cachedFile = new File(cachedItem.fileUri);
      if (cachedFile.exists) {
        return { ...content, fileUri: cachedItem.fileUri };
      }
    }
  }

  const finalContent = needsDownload
    ? await downloadRemoteClipboard(content, onProgress, signal)
    : content;
  if (finalContent && finalContent.type === 'Text') {
    await localClipboard.setClipboardContent(finalContent, true);
  }
  return finalContent;
}
