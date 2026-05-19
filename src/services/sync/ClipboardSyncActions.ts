import type { ClipboardContent } from '@/types/clipboard';
import type { ProgressInfo } from '@/types/progress';
import { historyService } from '../history/HistoryService';
import { getClientService } from '../client/ClientService';
import { configService } from '../ConfigService';
import { remoteClipboardMonitor } from './RemoteClipboardMonitor';

/** 当前正在执行的上传控制器，用于取消上一个未完成的实例 */
let _currentController: AbortController | null = null;

/**
 * 上传文件到远程剪贴板，并将内容添加到本地历史记录。
 * 同时只允许一个实例运行；新调用会取消尚未完成的上一次调用。
 * @param content 已构建好的剪贴板内容（含 profileHash、fileUri 等）
 * @param signal 外部取消信号
 * @param onProgress 上传进度回调
 */
export async function setRemoteClipboard(
  content: ClipboardContent,
  signal: AbortSignal,
  onProgress?: (info: ProgressInfo) => void
): Promise<void> {
  // 取消上一个正在进行的实例
  _currentController?.abort();

  const controller = new AbortController();
  _currentController = controller;

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
  } finally {
    signal.removeEventListener('abort', onExternalAbort);
    if (_currentController === controller) {
      _currentController = null;
    }
  }
}
