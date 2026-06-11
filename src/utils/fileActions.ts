/**
 * File Action Utilities
 * 文件操作公共函数 - 打开、分享文件
 */

import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Directory, File } from 'expo-file-system';
import { nativeCopyFile, nativeSaveFileToDownloads } from 'native-util';
import i18n from '@/i18n';

const APP_PACKAGE = 'com.jericx.syncclipboardmobile';

/**
 * 检测 SAF 返回的目录 URI 是否是 Downloads 根目录。
 * Android 11+ 不允许通过 SAF 写入 Downloads 根目录，需切换为 MediaStore。
 * Downloads 子目录可以正常通过 SAF 写入，无需特殊处理。
 *
 * Downloads 根目录的 URI 形式：
 * - Downloads provider root: .../tree/downloads（tree doc ID 为字面量 "downloads"）
 * - External storage provider Downloads 根: .../tree/primary%3ADownload（decoded = "primary:Download"）
 */
function isDownloadsRootUri(directoryUri: string): boolean {
  const treeMatch = directoryUri.match(/\/tree\/([^/?#]+)/i);
  if (!treeMatch) return false;
  const treeDocId = decodeURIComponent(treeMatch[1]);
  // Downloads provider 根目录：tree doc ID 就是 "downloads"
  if (treeDocId.toLowerCase() === 'downloads') return true;
  // External storage provider 指向 Download 根目录（没有子路径）
  if (/^primary:download$/i.test(treeDocId)) return true;
  return false;
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
 * 将文件保存到指定目录（如果文件已存在则覆盖）
 * @param fileUri 源文件 URI
 * @param directoryUri 目标目录 URI
 * @param fileName 文件名
 * @param mimeType MIME 类型（可选，不提供则自动推断）
 */
export async function saveFileToDirectory(
  fileUri: string,
  directoryUri: string,
  fileName: string,
  mimeType?: string
): Promise<void> {
  const resolvedMimeType = mimeType ?? getMimeTypeFromUri(fileUri);

  // 只有 Downloads 根目录才切换为 MediaStore（Android 11+ 限制根目录）
  if (isDownloadsRootUri(directoryUri)) {
    await nativeSaveFileToDownloads(fileUri, fileName, resolvedMimeType, 'Download/');
    return;
  }

  // 先检查文件是否存在，如果存在则删除
  const destDir = new Directory(directoryUri);
  const existingFile = new File(destDir, fileName);
  if (existingFile.exists) {
    await FileSystem.deleteAsync(existingFile.uri);
  }

  const destUri = await FileSystem.StorageAccessFramework.createFileAsync(
    directoryUri,
    fileName,
    resolvedMimeType
  );

  await nativeCopyFile(fileUri, destUri);
}

/**
 * 将文件保存到用户选择的目录（弹出系统目录选择器）
 * 若用户选择了 Downloads 根目录，自动切换为 MediaStore.Downloads 写入以绕过 Android 11+ 限制。
 */
export async function saveFile(fileUri: string, fileName?: string): Promise<void> {
  const name = fileName || fileUri.split('/').pop() || 'file';
  const mimeType = getMimeTypeFromUri(fileUri);

  const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permissions.granted) {
    throw new Error('Storage permission denied');
  }

  await saveFileToDirectory(fileUri, permissions.directoryUri, name, mimeType);
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
