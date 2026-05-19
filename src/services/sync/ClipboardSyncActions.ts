import type { ClipboardContent } from '@/types/clipboard';
import type { ProgressInfo } from '@/types/progress';
import { historyService } from '../history/HistoryService';
import { getClientService } from '../client/ClientService';
import { configService } from '../ConfigService';
import { remoteClipboardMonitor } from './RemoteClipboardMonitor';
import { clipboardSyncState } from './SyncState';
import { clipboardMonitor } from '../clipboard/ClipboardMonitor';

/** 同步优先级：external（高，外部触发）或 currentlocal（低，当前本地自动） */
export type SyncPriority = 'external' | 'currentlocal';

const PRIORITY_LEVEL: Record<SyncPriority, number> = {
  external: 1,
  currentlocal: 0,
};

/** 当前正在执行的上传控制器，用于取消上一个未完成的实例 */
let _currentController: AbortController | null = null;
let _currentPriority: SyncPriority = 'currentlocal';

/**
 * 上传文件到远程剪贴板，并将内容添加到本地历史记录。
 * 同时只允许一个实例运行；高优先级可打断同等或更低优先级，低优先级无法打断高优先级。
 * @param content 已构建好的剪贴板内容（含 profileHash、fileUri 等）
 * @param priority 同步优先级，'external' 为外部触发（高），'currentlocal' 为本地自动（低）
 * @param signal 外部取消信号
 * @param onProgress 上传进度回调
 * @returns `true` 表示上传已完成，`false` 表示因低优先级被跳过（高优先级正在执行）
 * @throws 当被更高优先级打断（AbortError）或发生其他错误时抛出
 */
export async function setRemoteClipboard(
  content: ClipboardContent,
  priority: SyncPriority,
  signal: AbortSignal,
  onProgress?: (info: ProgressInfo) => void
): Promise<boolean> {
  // 仅在新优先级 >= 当前优先级时才打断正在进行的实例
  if (_currentController && PRIORITY_LEVEL[priority] >= PRIORITY_LEVEL[_currentPriority]) {
    _currentController.abort();
  } else if (_currentController) {
    // 低优先级无法打断高优先级，跳过本次执行
    return false;
  }

  const controller = new AbortController();
  _currentController = controller;
  _currentPriority = priority;

  // 将外部 signal 的取消转发给内部 controller
  const onExternalAbort = () => controller.abort(signal.reason);
  if (signal.aborted) {
    controller.abort(signal.reason);
  } else {
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const server = await configService.getActiveServer();
    if (!server) throw new Error('请先在设置中配置服务器');

    await historyService.addLocalContent(content);

    await getClientService().setRemoteClipboard(content, onProgress, controller.signal);

    if (content.profileHash) {
      remoteClipboardMonitor.setLastContentHash(content.profileHash);
    }
    return true;
  } finally {
    signal.removeEventListener('abort', onExternalAbort);
    if (_currentController === controller) {
      _currentController = null;
    }
  }
}

/**
 * 上传内容到远程剪贴板，并同步更新本地剪贴板卡片的上传状态（uploadingClipboard）。
 * 内部使用引用计数，支持与其他上传操作并发而不互相干扰状态。
 * @param content 剪贴板内容；为 null/undefined 时自动从本地剪贴板读取
 * @returns `true` 表示上传已完成，`false` 表示因低优先级被跳过或无内容可上传
 */
export async function uploadLocalClipboard(
  content: ClipboardContent | null | undefined,
  onProgress?: (info: ProgressInfo) => void
): Promise<boolean> {
  const actualContent = content ?? clipboardMonitor.getLastContent();
  if (!actualContent) return false;
  const controller = new AbortController();
  clipboardSyncState.setUploadingClipboard(true);
  try {
    return await setRemoteClipboard(actualContent, 'currentlocal', controller.signal, onProgress);
  } finally {
    clipboardSyncState.setUploadingClipboard(false);
  }
}

/** 取消当前正在进行的本地上传（如有） */
export function cancelUploadLocalClipboard(): void {
  _currentController?.abort();
}
