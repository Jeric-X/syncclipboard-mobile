import { SyncDirection } from '@/types/sync';

const QUICK_UPLOAD_URL = 'syncclipboard://quick-upload';
const QUICK_DOWNLOAD_URL = 'syncclipboard://quick-download';

export function parseQuickTileUrl(url: string | null): {
  isQuickTile: boolean;
  fromForeground: boolean;
  direction: SyncDirection;
} {
  if (!url) return { isQuickTile: false, fromForeground: false, direction: SyncDirection.Download };
  const fromForeground = url.includes('fg=1');
  if (url.startsWith(QUICK_UPLOAD_URL)) {
    return { isQuickTile: true, fromForeground, direction: SyncDirection.Upload };
  }
  if (url.startsWith(QUICK_DOWNLOAD_URL)) {
    return { isQuickTile: true, fromForeground, direction: SyncDirection.Download };
  }
  return { isQuickTile: false, fromForeground: false, direction: SyncDirection.Download };
}

export function isShareIntentUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === 'expo-sharing';
  } catch {
    return false;
  }
}

/** 只有普通主界面冷启动才允许自动更新检查，overlay 启动必须跳过。 */
export function shouldEnableAutoUpdateCheck(url: string | null): boolean {
  return !isShareIntentUrl(url) && !parseQuickTileUrl(url).isQuickTile;
}
