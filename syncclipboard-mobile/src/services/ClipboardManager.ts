/**
 * Clipboard Manager
 * 剪贴板管理器 - 处理剪贴板读写操作
 */

import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { ClipboardContent } from '@/types';
import { calculateTextHash } from '@/utils/hash';

/**
 * 剪贴板管理器类
 */
export class ClipboardManager {
  private lastHash: string = '';

  /**
   * 获取当前剪贴板内容
   */
  async getClipboardContent(): Promise<ClipboardContent | null> {
    try {
      // 检查是否有图片
      const hasImage = await Clipboard.hasImageAsync();
      if (hasImage) {
        return await this.getImageContent();
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
    const hash = await calculateTextHash(text);

    return {
      type: 'Text',
      text,
      hash,
    };
  }

  /**
   * 获取图片内容
   */
  private async getImageContent(): Promise<ClipboardContent> {
    try {
      // 尝试获取图片，如果失败则返回文本占位符
      // expo-clipboard 的图片API在某些平台上可能不完全支持
      const text = await Clipboard.getStringAsync();
      const hash = await calculateTextHash(text || '[图片]');

      return {
        type: 'Image',
        text: '[图片]',
        hash,
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
      this.lastHash = await calculateTextHash(text);
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
      await Clipboard.setImageAsync(imageUri);
      this.lastHash = await calculateTextHash(imageUri);
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
        if (content.imageUri) {
          await this.setImageContent(content.imageUri);
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
      this.lastHash = '';
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
      if (!content || !content.hash) {
        return false;
      }

      const hasChanged = content.hash !== this.lastHash;
      if (hasChanged) {
        this.lastHash = content.hash;
      }

      return hasChanged;
    } catch (error) {
      console.error('[ClipboardManager] Failed to check clipboard change:', error);
      return false;
    }
  }

  /**
   * 获取上次记录的 hash
   */
  getLastHash(): string {
    return this.lastHash;
  }

  /**
   * 重置上次记录的 hash
   */
  resetLastHash(): void {
    this.lastHash = '';
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
      const hash = await calculateTextHash(asset.uri);

      return {
        type: 'Image',
        text: '[图片]',
        imageUri: asset.uri,
        fileSize: asset.fileSize,
        hash,
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
      const hash = await calculateTextHash(asset.uri);

      return {
        type: 'Image',
        text: '[图片]',
        imageUri: asset.uri,
        fileSize: asset.fileSize,
        hash,
      };
    } catch (error) {
      console.error('[ClipboardManager] Failed to take photo:', error);
      return null;
    }
  }
}

// 导出单例
export const clipboardManager = new ClipboardManager();
