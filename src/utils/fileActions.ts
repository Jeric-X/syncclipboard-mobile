/**
 * File Action Utilities
 * 文件操作公共函数 - 打开、分享文件
 */

import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { nativeCopyFileToDirectory, type ProgressInfo } from 'native-util';
import i18n from '@/i18n';

const APP_PACKAGE = 'com.jericx.syncclipboardmobile';

/**
 * 将文件复制到指定目录。
 *
 * 底层通过 native 的 WritableLocation 统一处理 SAF 和 MediaStore 写入路径，
 * JS 侧完全不需要感知目标目录是否为 Downloads 根目录。
 *
 * @param fileUri      源文件 URI
 * @param directoryUri 目标目录 URI
 * @param fileName     目标文件名，为空则使用源文件名
 * @param overwrite    是否覆盖同名文件
 * @param signal       取消信号
 * @param onProgress   进度回调
 */
export async function copyFileToDirectory(
  fileUri: string,
  directoryUri: string,
  fileName: string = '',
  overwrite: boolean = false,
  signal?: AbortSignal,
  onProgress?: (info: ProgressInfo) => void
): Promise<void> {
  await nativeCopyFileToDirectory(fileUri, directoryUri, fileName, overwrite, signal, onProgress);
}

/**
 * 根据文件 URI / 文件名推断 MIME 类型
 */
export function getMimeTypeFromUri(fileUri: string): string {
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
  return 'application/octet-stream';
}

/**
 * 通过系统 ACTION_VIEW Intent 打开文件
 * - APK 安装失败时自动跳转"安装未知来源"设置页
 * - Android 7+ 要求使用 content:// URI
 */
export async function openFile(fileUri: string): Promise<void> {
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
 * 将文件保存到用户选择的目录（弹出系统目录选择器）
 */
export async function saveFile(fileUri: string, fileName?: string): Promise<void> {
  const name = fileName || fileUri.split('/').pop() || 'file';

  const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permissions.granted) {
    throw new Error('Storage permission denied');
  }

  await copyFileToDirectory(fileUri, permissions.directoryUri, name, true);
}

/**
 * 通过系统分享对话框分享文件
 */
export async function shareFile(fileUri: string, fileName?: string): Promise<void> {
  const mimeType = getMimeTypeFromUri(fileUri);
  await Sharing.shareAsync(fileUri, {
    mimeType,
    dialogTitle: fileName || i18n.t('common.shareFile'),
    UTI: mimeType,
  });
}

/**
 * 保存图片到相册
 * 仅支持图片类型文件
 */
export async function saveToGallery(fileUri: string): Promise<void> {
  const mimeType = getMimeTypeFromUri(fileUri);
  const isImage = mimeType.startsWith('image/');

  if (!isImage) {
    throw new Error(i18n.t('clipboard.onlyImageToGallery'));
  }

  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Media library permission denied');
  }

  await MediaLibrary.createAssetAsync(fileUri);
}
