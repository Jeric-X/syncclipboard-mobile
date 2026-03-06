/**
 * File Action Utilities
 * 文件操作公共函数 - 打开、分享文件
 */

import * as Sharing from 'expo-sharing';

const APP_PACKAGE = 'com.jericx.syncclipboardmobile';

/**
 * 根据文件 URI / 文件名推断 MIME 类型（模块私有）
 */
function getMimeTypeFromUri(fileUri: string): string {
  const name = fileUri.split('?')[0].toLowerCase();
  if (name.endsWith('.apk')) return 'application/vnd.android.package-archive';
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.mp4') || name.endsWith('.mkv') || name.endsWith('.avi')) return 'video/*';
  if (name.endsWith('.mp3') || name.endsWith('.flac') || name.endsWith('.aac')) return 'audio/*';
  if (
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.gif') ||
    name.endsWith('.webp') ||
    name.endsWith('.bmp') ||
    name.endsWith('.prm') // expo image format
  )
    return 'image/*';
  return '*/*';
}

/**
 * 通过系统 ACTION_VIEW Intent 打开文件
 * - APK 安装失败时自动跳转"安装未知来源"设置页
 * - Android 7+ 要求使用 content:// URI
 */
export async function openFile(fileUri: string): Promise<void> {
  const FileSystem = await import('expo-file-system/legacy');
  const IntentLauncher = await import('expo-intent-launcher');
  const mimeType = getMimeTypeFromUri(fileUri);

  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: mimeType,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    });
  } catch (error) {
    // APK 安装失败时引导开启"安装未知来源"权限
    if (mimeType === 'application/vnd.android.package-archive') {
      try {
        await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
          data: `package:${APP_PACKAGE}`,
        });
      } catch {}
    }
    throw error;
  }
}

/**
 * 通过系统分享对话框分享文件
 */
export async function shareFile(fileUri: string, fileName?: string): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();
  if (isAvailable) {
    const mimeType = getMimeTypeFromUri(fileUri);
    await Sharing.shareAsync(fileUri, {
      mimeType: mimeType === '*/*' ? undefined : mimeType,
      dialogTitle: fileName || '分享文件',
    });
  }
}
