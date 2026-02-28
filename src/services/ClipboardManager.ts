/**
 * Clipboard Manager
 * 剪贴板管理器 - 处理剪贴板读写操作
 */

import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Paths, Directory } from 'expo-file-system';
import { ClipboardContent } from '@/types';
import { calculateTextHash, calculateBase64Hash, calculateBase64ContentHash } from '@/utils/hash';
import { historyStorage } from './HistoryStorage';

// 临时剪贴板图片存储目录
export const CLIPBOARD_TEMP_DIR = new Directory(Paths.cache, 'clipboard_images');

/**
 * 剪贴板管理器类
 */
export class ClipboardManager {
  private lastProfileHash: string = '';

  /**
   * 获取当前剪贴板内容
   * @param createTempFile 是否创建临时文件
   */
  async getClipboardContent(createTempFile: boolean = true): Promise<ClipboardContent | null> {
    try {
      // 检查是否有图片
      const hasImage = await Clipboard.hasImageAsync();
      if (hasImage) {
        return await this.getImageContent(createTempFile);
      }

      // 检查是否有文本
      const hasString = await Clipboard.hasStringAsync();
      if (hasString) {
        return await this.getTextContent();
      }

      // 没有内容
      return null;
    } catch (error) {
      console.error('[ClipboardManager] Failed to get clipboard content:', error);
      return null;
    }
  }

  /**
   * 获取文本内容
   */
  private async getTextContent(): Promise<ClipboardContent> {
    const text = await Clipboard.getStringAsync();
    const profileHash = await calculateTextHash(text);

    return {
      type: 'Text',
      text,
      profileHash, // 文本类型，profileHash 和 localClipboardHash 相同
      localClipboardHash: profileHash, // 用于本地变化检测
      timestamp: Date.now(),
    };
  }

  /**
   * 获取图片内容
   * @param createTempFile 是否创建临时文件
   */
  private async getImageContent(createTempFile: boolean): Promise<ClipboardContent> {
    try {
      // 使用 getImageAsync 获取图片数据
      const imageData = await Clipboard.getImageAsync({ format: 'png' });

      if (!imageData || !imageData.data) {
        throw new Error('No image data in clipboard');
      }

      const timestamp = Date.now();

      // 使用 File API 创建文件
      const { File } = FileSystem;

      // 确保临时目录存在（使用更稳妥的方式）
      try {
        if (!CLIPBOARD_TEMP_DIR.exists) {
          CLIPBOARD_TEMP_DIR.create();
        }
      } catch (dirError) {
        console.error('[ClipboardManager] Failed to create directory:', dirError);
        // 如果目录创建失败，尝试重新创建
        CLIPBOARD_TEMP_DIR.create();
      }

      // 清理 base64 字符串：移除可能的 data URI 前缀和空白字符
      let base64String = imageData.data;

      // 移除 data:image/png;base64, 等前缀
      if (base64String.includes(',')) {
        base64String = base64String.split(',')[1];
      }

      // 移除所有空白字符
      base64String = base64String.replace(/\s/g, '');

      // 步骤1: 计算本地变化检测用的 hash（快速比较）
      const localClipboardHash = await calculateBase64Hash(base64String);

      // 步骤2: 根据 localClipboardHash 查询历史记录
      let historyItem = await historyStorage.getItemByLocalHash(localClipboardHash);

      let fileUri: string;
      let fileSize: number | undefined;
      let fileHash: string;
      let fileHashName: string;
      let profileHash: string;

      if (historyItem && historyItem.hasData && historyItem.dataName) {
        // console.log('[ClipboardManager] Found image in history:', {
        //   localClipboardHash: localClipboardHash.substring(0, 16) + '...',
        //   dataName: historyItem.dataName,
        // });

        // 从历史记录中获取文件路径
        const { getHistoryFileUri } = await import('@/utils/fileStorage');
        const historyFileUri = await getHistoryFileUri(
          'Image',
          historyItem.profileHash,
          historyItem.dataName
        );

        if (historyFileUri) {
          // console.log('[ClipboardManager] Using history file:', historyFileUri);
          // 使用历史记录中的文件
          const { File } = FileSystem;
          const historyFile = new File(historyFileUri);

          if (historyFile.exists) {
            fileUri = historyFile.uri;
            fileSize = historyFile.size;
            fileHashName = historyItem.dataName;

            // 读取文件计算正确的 fileHash（文件二进制内容的 SHA256）
            const savedBase64 = await historyFile.base64();
            fileHash = await calculateBase64ContentHash(savedBase64);

            // 步骤3: 根据服务器规则计算 profileHash = SHA256(fileName + "|" + fileHash.ToUpper())
            const combinedString = `${fileHashName}|${fileHash.toUpperCase()}`;
            profileHash = await calculateTextHash(combinedString);

            return {
              type: 'Image',
              text: '[图片]',
              fileUri: fileUri,
              fileName: fileHashName,
              fileSize,
              profileHash, // 用于服务器上传
              localClipboardHash, // 用于本地变化检测
              timestamp,
            };
          }
        }
      }

      // 历史记录中没有找到，继续处理
      // 将 base64 转换为二进制数据用于保存文件
      const binaryString = atob(base64String);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      if (createTempFile) {
        // 步骤2: 先用本地 hash 创建临时文件名
        const tempFileName = `${localClipboardHash.substring(0, 16)}.png`;

        // 再次确保目录存在（写入前双重检查）
        if (!CLIPBOARD_TEMP_DIR.exists) {
          CLIPBOARD_TEMP_DIR.create();
        }

        const tempFile = new File(CLIPBOARD_TEMP_DIR, tempFileName);

        // 检查文件是否已存在
        if (tempFile.exists) {
          // 文件已存在，直接使用
          fileUri = tempFile.uri;
          fileSize = tempFile.size;

          // 读取文件计算正确的 fileHash（文件二进制内容的 SHA256）
          const savedBase64 = await tempFile.base64();
          fileHash = await calculateBase64ContentHash(savedBase64);
          fileHashName = `${fileHash.substring(0, 16)}.png`;
        } else {
          // 文件不存在，写入新文件
          console.log('[ClipboardManager] Saving new image:', {
            fileName: tempFileName,
            binaryLength: bytes.length,
          });

          try {
            // 写入二进制数据
            tempFile.write(bytes);
            fileUri = tempFile.uri;
            fileSize = tempFile.size;

            // 保存后读回计算正确的 fileHash（用于服务器）
            const savedBase64 = await tempFile.base64();
            fileHash = await calculateBase64ContentHash(savedBase64);
            fileHashName = `${fileHash.substring(0, 16)}.png`;

            console.log('[ClipboardManager] Image saved successfully:', {
              fileHash: fileHash.substring(0, 16) + '...',
              fileName: fileHashName,
              size: fileSize,
            });
          } catch (writeError) {
            console.error('[ClipboardManager] Failed to write file:', writeError);
            console.error('[ClipboardManager] File path:', tempFile.uri);
            console.error('[ClipboardManager] Directory exists:', CLIPBOARD_TEMP_DIR.exists);
            throw writeError;
          }
        }
      } else {
        // 不创建临时文件，直接计算 hash
        fileHash = await calculateBase64ContentHash(base64String);
        fileHashName = `${fileHash.substring(0, 16)}.png`;
        fileUri = '';
        fileSize = bytes.length;
      }

      // 步骤3: 根据服务器规则计算 profileHash = SHA256(fileName + "|" + fileHash.ToUpper())
      const combinedString = `${fileHashName}|${fileHash.toUpperCase()}`;
      profileHash = await calculateTextHash(combinedString);

      return {
        type: 'Image',
        text: '[图片]',
        fileUri: fileUri,
        fileName: fileHashName,
        fileSize,
        profileHash, // 用于服务器上传
        localClipboardHash, // 用于本地变化检测
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
  async setTextContent(text: string): Promise<void> {
    try {
      await Clipboard.setStringAsync(text);

      // 计算并更新 localClipboardHash（用于本地变化检测）
      const localClipboardHash = await calculateTextHash(text);
      this.lastProfileHash = localClipboardHash;
    } catch (error) {
      console.error('[ClipboardManager] Failed to set text content:', error);
      throw new Error('Failed to set text to clipboard');
    }
  }

  /**
   * 设置图片到剪贴板
   */
  async setImageContent(imageUri: string): Promise<void> {
    try {
      // expo-clipboard 需要纯 base64 格式的图片数据（不带 MIME 类型前缀）
      // 使用新的 File API 读取图片文件并转换为 base64
      const { File } = FileSystem;
      const file = new File(imageUri);
      const base64 = await file.base64();

      // 直接传递纯 base64 字符串（Clipboard.setImageAsync 不需要 data URI 前缀）
      await Clipboard.setImageAsync(base64);

      // 计算并更新 localClipboardHash（用于本地变化检测）
      const localClipboardHash = await calculateBase64Hash(base64);
      this.lastProfileHash = localClipboardHash;
    } catch (error) {
      console.error('[ClipboardManager] Failed to set image content:', error);
      throw new Error('Failed to set image to clipboard');
    }
  }

  /**
   * 设置剪贴板内容
   */
  async setClipboardContent(content: ClipboardContent): Promise<void> {
    switch (content.type) {
      case 'Text':
        if (content.text) {
          await this.setTextContent(content.text);
        }
        break;

      case 'Image':
        if (content.fileUri) {
          await this.setImageContent(content.fileUri);
        }
        break;

      case 'File':
      case 'Group':
        // 文件和文件组暂不支持直接设置到剪贴板
        // 可以设置文件路径或名称作为文本
        if (content.text) {
          await this.setTextContent(content.text);
        }
        break;

      default:
        throw new Error(`Unsupported clipboard type: ${content.type}`);
    }
  }

  /**
   * 清空剪贴板
   */
  async clearClipboard(): Promise<void> {
    try {
      await Clipboard.setStringAsync('');
      this.lastProfileHash = '';
    } catch (error) {
      console.error('[ClipboardManager] Failed to clear clipboard:', error);
      throw new Error('Failed to clear clipboard');
    }
  }

  /**
   * 检查剪贴板内容是否发生变化
   */
  async hasClipboardChanged(): Promise<boolean> {
    try {
      const content = await this.getClipboardContent();
      if (!content || !content.profileHash) {
        return false;
      }

      const hasChanged = content.profileHash !== this.lastProfileHash;
      if (hasChanged) {
        this.lastProfileHash = content.profileHash;
      }

      return hasChanged;
    } catch (error) {
      console.error('[ClipboardManager] Failed to check clipboard change:', error);
      return false;
    }
  }

  /**
   * 获取上次记录的 profileHash
   */
  getLastProfileHash(): string {
    return this.lastProfileHash;
  }

  /**
   * 重置上次记录的 profileHash
   */
  resetLastProfileHash(): void {
    this.lastProfileHash = '';
  }

  /**
   * 从相册选择图片
   */
  async pickImageFromGallery(): Promise<ClipboardContent | null> {
    try {
      // 请求权限
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Permission to access media library denied');
      }

      // 选择图片
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return null;
      }

      const asset = result.assets[0];
      const profileHash = await calculateTextHash(asset.uri);

      return {
        type: 'Image',
        text: '[图片]',
        fileUri: asset.uri,
        fileSize: asset.fileSize,
        profileHash,
      };
    } catch (error) {
      console.error('[ClipboardManager] Failed to pick image:', error);
      return null;
    }
  }

  /**
   * 拍照
   */
  async takePhoto(): Promise<ClipboardContent | null> {
    try {
      // 请求权限
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Permission to access camera denied');
      }

      // 拍照
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return null;
      }

      const asset = result.assets[0];
      const profileHash = await calculateTextHash(asset.uri);

      return {
        type: 'Image',
        text: '[图片]',
        fileUri: asset.uri,
        fileSize: asset.fileSize,
        profileHash,
      };
    } catch (error) {
      console.error('[ClipboardManager] Failed to take photo:', error);
      return null;
    }
  }
}

// 导出单例
export const clipboardManager = new ClipboardManager();
