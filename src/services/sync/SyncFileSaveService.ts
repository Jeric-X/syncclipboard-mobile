import type { ClipboardContent } from '@/types/clipboard';
import type { ProgressInfo } from '@/types/progress';
import { configService } from '../ConfigService';
import { File } from 'expo-file-system';
import { saveContentDataToDirectory } from '@/utils/clipboard/clipboardContentUtils';
import i18n from '@/i18n';
import { Platform, ToastAndroid } from 'react-native';

/**
 * 将同步的文件保存到用户指定的目录
 * @param content 下载完成的剪贴板内容
 * @param signal 取消信号
 * @param onProgress 进度回调
 */
export async function saveSyncFileToUserPath(
  content: ClipboardContent,
  signal?: AbortSignal,
  onProgress?: (info: ProgressInfo) => void
): Promise<void> {
  // 只处理 File 和 Group 类型
  if (content.type !== 'File' && content.type !== 'Group') {
    return;
  }

  // 检查是否有文件数据
  if (!content.fileUri) return;

  const config = await configService.getConfig();

  // 检查是否启用自动保存和是否有保存路径
  if (!config.autoSaveSyncFile || !config.syncFileSavePath) return;

  try {
    const sourceFile = new File(content.fileUri);
    if (!sourceFile.exists) {
      console.warn('[saveSyncFileToUserPath] Source file does not exist:', content.fileUri);
      return;
    }

    await saveContentDataToDirectory(content, config.syncFileSavePath, signal, onProgress);
    console.log('[saveSyncFileToUserPath] File saved to:', config.syncFileSavePath);
  } catch (error) {
    console.error('[saveSyncFileToUserPath] Failed to save file:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (Platform.OS === 'android') {
      ToastAndroid.show(`${i18n.t('history.saveFailed')}: ${errorMessage}`, ToastAndroid.LONG);
    }
  }
}
