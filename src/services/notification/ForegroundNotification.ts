import { Platform } from 'react-native';

/**
 * 更新前台服务通知文本。
 * 将 "操作: 预览" 格式转换为双行显示："操作\n预览"
 */
export function updateForegroundNotification(text: string): void {
  if (Platform.OS !== 'android') return;
  const colonIdx = text.indexOf(': ');
  let content: string;
  if (colonIdx >= 0) {
    const action = text.slice(0, colonIdx);
    const preview = text.slice(colonIdx + 2);
    content = `${action}\n${preview}`;
  } else {
    content = `SyncClipboard\n${text}`;
  }
  import('foreground-service')
    .then((ForegroundService) => {
      ForegroundService.updateNotification(content);
    })
    .catch(() => {
      // foreground service module not available
    });
}
