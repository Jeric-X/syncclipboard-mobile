/**
 * Clipboard Manager
 * 剪贴板管理器 - 处理剪贴板读写操作
 */

import * as Clipboard from 'expo-clipboard';
import * as ClipboardProxy from '@/utils/clipboardProxy';
import * as FileSystem from 'expo-file-system';
import { ClipboardContent } from '@/types';
import { calculateTextHash, calculateFileHash } from '@/utils/hash';
import { isTextInvalid } from '@/utils/index';
import { historyStorage } from '../../storage/HistoryStorage';
import { prepareTempFilePath, CLIPBOARD_TEMP_DIR } from '@/utils/fileStorage';
import { nativeSetClipboardImageFromFile } from 'native-util';

/**
 * 剪贴板复制生命周期回调，由外部模块（如 ClipboardMonitor）注册
 */
export interface CopyLifecycleCallbacks {
  /** 复制开始前调用（暂停轮询） */
  onBeforeCopy: () => void;
  /** 复制结束后调用，无论成功与否（恢复轮询） */
  onAfterCopy: () => void;
}

/**
 * 剪贴板管理器类
 */
export class LocalClipboard {
  private copyLifecycleCallbacks: CopyLifecycleCallbacks | null = null;
  private remoteCopiedCallback: ((content: ClipboardContent) => void) | null = null;

  /**
   * 注册复制生命周期回调（由 ClipboardMonitor 调用）
   */
  registerCopyLifecycleCallbacks(callbacks: CopyLifecycleCallbacks): void {
    this.copyLifecycleCallbacks = callbacks;
  }

  registerRemoteCopiedCallback(callback: ((content: ClipboardContent) => void) | null): void {
    this.remoteCopiedCallback = callback;
  }

  /**
   * 获取当前剪贴板内容
   */
  async getClipboardContent(): Promise<ClipboardContent | null> {
    try {
      // Directly try getting text first (avoids extra overlay windows for type checks)
      const text = await ClipboardProxy.getStringAsync();
      if (text && text.length > 0) {
        return await this.getTextContentFromString(text);
      }

      // If no text, check for image
      const hasImage = await ClipboardProxy.hasImageAsync();
      if (hasImage) {
        return await this.getImageContent();
      }

      // 没有内容
      return null;
    } catch (error) {
      console.error('[ClipboardManager] Failed to get clipboard content:', error);
      return null;
    }
  }

  /**
   * 获取文本内容（从已获取的文本字符串构建）
   */
  private async getTextContentFromString(text: string): Promise<ClipboardContent> {
    const profileHash = await calculateTextHash(text);
    const timestamp = Date.now();

    // 步骤1: 根据 profileHash 查询历史记录
    let historyItem = await historyStorage.getItemByLocalHash(profileHash);

    if (historyItem && historyItem.type === 'Text') {
      // 如果历史记录有外部文件，验证文件是否存在
      if (historyItem.hasData && historyItem.dataName) {
        const { getHistoryFileUri } = await import('@/utils/fileStorage');
        const historyFileUri = await getHistoryFileUri(
          'Text',
          historyItem.profileHash,
          historyItem.dataName
        );

        if (historyFileUri) {
          const { File } = FileSystem;
          const historyFile = new File(historyFileUri);

          if (historyFile.exists) {
            // 生成预览文本：如果有历史文本则使用，否则从当前文本取前200字符
            let previewText = historyItem.text;
            if (!previewText) {
              previewText = text.length > 200 ? text.substring(0, 200) + '...' : text;
            }

            // 使用历史记录中的文件信息
            return {
              type: 'Text',
              text: previewText,
              fileUri: historyFile.uri,
              fileName: historyItem.dataName,
              fileSize: historyItem.size || text.length,
              profileHash: historyItem.profileHash,
              localClipboardHash: historyItem.profileHash, // 文本类型，两者相同
              hasData: true,
              timestamp,
            };
          }
        }
      } else {
        // 历史记录中的短文本，直接返回
        return {
          type: 'Text',
          text: historyItem.text || text,
          fileSize: historyItem.size || text.length,
          profileHash: historyItem.profileHash,
          localClipboardHash: historyItem.profileHash,
          hasData: false,
          timestamp,
        };
      }
    }

    // 历史记录中没有找到或文件不存在，继续处理
    // 文本长度阈值（字符数），超过此长度将保存为文件
    const TEXT_STORAGE_THRESHOLD = 1000;
    const TEXT_PREVIEW_MAX_LENGTH = 200;

    // 如果文本长度超过阈值，保存为文件
    if (text.length > TEXT_STORAGE_THRESHOLD) {
      try {
        // 生成文件名
        const fileName = `${profileHash}.txt`;
        const tempFile = new FileSystem.File(prepareTempFilePath(fileName));

        // 检查文件是否已存在
        if (!tempFile.exists) {
          // 文件不存在，保存完整文本到文件
          tempFile.write(new TextEncoder().encode(text));
          console.log(`[ClipboardManager] Text saved to file: ${fileName}, length: ${text.length}`);
        } else {
          // 文件已存在，直接使用
          console.log(
            `[ClipboardManager] Text file already exists: ${fileName}, length: ${text.length}`
          );
        }

        // 生成预览文本
        const previewText =
          text.length > TEXT_PREVIEW_MAX_LENGTH
            ? text.substring(0, TEXT_PREVIEW_MAX_LENGTH) + '...'
            : text;

        return {
          type: 'Text',
          text: previewText, // 只保存预览文本在内存中
          fileUri: tempFile.uri, // 文件路径
          fileName: fileName,
          fileSize: text.length,
          profileHash,
          localClipboardHash: profileHash, // 文本类型，profileHash 和 localClipboardHash 相同
          hasData: true, // 标记有外部文件
          timestamp,
        };
      } catch (error) {
        console.error('[ClipboardManager] Failed to save text to file:', error);
        // 出错时降级为普通文本处理
      }
    }

    // 短文本或保存失败时，直接返回
    return {
      type: 'Text',
      text,
      fileSize: text.length, // 设置文字数量
      profileHash,
      localClipboardHash: profileHash,
      hasData: false, // 短文本没有外部文件
      timestamp,
    };
  }

  /**
   * 获取图片内容
   * @param createTempFile 是否创建临时文件
   */
  private async getImageContent(): Promise<ClipboardContent> {
    try {
      const timestamp = Date.now();
      const { File } = FileSystem;

      // ========== 阶段1: Native 侧直接将剪贴板图片写入临时目录（不经过 JS 内存） ==========
      // Native 侧根据 mimeType 自动确定文件扩展名
      if (!CLIPBOARD_TEMP_DIR.exists) {
        CLIPBOARD_TEMP_DIR.create();
      }
      const saved = await ClipboardProxy.saveImageToFileAsync(CLIPBOARD_TEMP_DIR.uri);
      if (!saved) {
        throw new Error('No image data in clipboard');
      }
      const randomTempFilePath = saved.filePath;
      const imageExt = saved.mimeType.includes('png')
        ? 'png'
        : saved.mimeType.includes('jpeg') || saved.mimeType.includes('jpg')
          ? 'jpg'
          : saved.mimeType.includes('gif')
            ? 'gif'
            : saved.mimeType.includes('webp')
              ? 'webp'
              : 'png';

      // ========== 阶段2: 从文件计算 localClipboardHash ==========
      const localClipboardHash = await calculateFileHash(randomTempFilePath);

      // 将随机命名的临时文件重命名为基于 hash 的确定性名称（便于去重）
      const hashTempFileName = `${localClipboardHash.substring(0, 16)}.${imageExt}`;
      let tempFilePath = prepareTempFilePath(hashTempFileName);
      const hashTempFile = new File(tempFilePath);
      if (hashTempFile.exists) {
        // 已有同内容文件，删除随机临时文件
        try {
          new File(randomTempFilePath).delete();
        } catch {}
      } else {
        // 重命名为 hash 命名
        try {
          new File(randomTempFilePath).move(hashTempFile);
        } catch {
          tempFilePath = randomTempFilePath;
        }
      }

      // ========== 阶段3: 基于文件进行后续操作 ==========

      // 根据 localClipboardHash 查询历史记录
      const historyItem = await historyStorage.getItemByLocalHash(localClipboardHash);

      if (historyItem && historyItem.hasData && historyItem.dataName) {
        // 从历史记录中获取文件路径
        const { getHistoryFileUri } = await import('@/utils/fileStorage');
        const historyFileUri = await getHistoryFileUri(
          'Image',
          historyItem.profileHash,
          historyItem.dataName
        );

        if (historyFileUri) {
          const historyFile = new File(historyFileUri);
          if (historyFile.exists) {
            return {
              type: 'Image',
              text: historyItem.dataName,
              fileUri: historyFile.uri,
              fileName: historyItem.dataName,
              fileSize: historyFile.size,
              profileHash: historyItem.profileHash,
              localClipboardHash,
              hasData: true,
              timestamp,
            };
          }
        }
      }

      // 历史记录中没有找到，使用临时文件
      const tempFile = new File(tempFilePath);
      const fileUri = tempFile.uri;
      const fileSize = tempFile.size;

      // 根据服务器规则计算 profileHash
      const combinedString = `${tempFile.name}|${localClipboardHash.toUpperCase()}`;
      const profileHash = await calculateTextHash(combinedString);

      return {
        type: 'Image',
        text: tempFile.name,
        fileUri,
        fileName: tempFile.name,
        fileSize,
        profileHash,
        localClipboardHash,
        hasData: true,
        timestamp,
      };
    } catch (error) {
      console.error('[ClipboardManager] Failed to get image:', error);
      throw new Error('Failed to get image from clipboard');
    }
  }

  /**
   * 设置文本到剪贴板
   */
  async setTextContent(content: ClipboardContent): Promise<void> {
    try {
      let text = content.text;
      if (content.type === 'Text' && content.fileUri && content.hasData) {
        try {
          const response = await fetch(content.fileUri);
          text = await response.text();
          console.log(
            `[ClipboardManager] Read complete text from file for profileHash: ${content.profileHash}, length: ${text.length}`
          );
        } catch (error) {
          console.error('[ClipboardManager] Failed to read text file:', error);
          if (isTextInvalid(content.text)) {
            throw new Error('无法读取完整文本');
          }
          // fallback to preview text
        }
      }
      if (isTextInvalid(text)) {
        return;
      }
      await Clipboard.setStringAsync(text!);
    } catch (error) {
      console.error('[ClipboardManager] Failed to set text content:', error);

      // 保留原始错误信息，特别是 TransactionTooLargeException
      if (error instanceof Error) {
        throw error; // 直接抛出原始错误，保留详细信息
      }
      throw new Error('Failed to set text to clipboard');
    }
  }

  /**
   * 设置图片到剪贴板
   */
  async setImageContent(imageUri: string): Promise<void> {
    try {
      // 直接通过 native 将文件设置到系统剪贴板（不经过 JS 内存/base64）
      const success = await nativeSetClipboardImageFromFile(imageUri);
      if (!success) {
        throw new Error('Native setClipboardImageFromFile returned false');
      }
    } catch (error) {
      console.error('[ClipboardManager] Failed to set image content:', error);
      throw new Error('Failed to set image to clipboard');
    }
  }

  /**
   * 设置剪贴板内容。写入期间自动暂停剪贴板监听，完成后恢复并立即触发一次检查。
   * 写入失败时直接抛出异常，由调用方处理。
   */
  async setClipboardContent(content: ClipboardContent, isFromRemote = false): Promise<void> {
    this.copyLifecycleCallbacks?.onBeforeCopy();
    try {
      switch (content.type) {
        case 'Text':
          await this.setTextContent(content);
          break;

        case 'Image':
          if (content.fileUri) {
            await this.setImageContent(content.fileUri);
          }
          break;

        case 'File':
        case 'Group':
        default:
          throw new Error(`Unsupported clipboard type: ${content.type}`);
      }
      if (isFromRemote) {
        this.remoteCopiedCallback?.(content);
      }
    } finally {
      this.copyLifecycleCallbacks?.onAfterCopy();
    }
  }

  /**
   * 清空剪贴板
   */
  async clearClipboard(): Promise<void> {
    try {
      await Clipboard.setStringAsync('');
    } catch (error) {
      console.error('[ClipboardManager] Failed to clear clipboard:', error);
      throw new Error('Failed to clear clipboard');
    }
  }
}

// 导出单例
export const localClipboard = new LocalClipboard();
