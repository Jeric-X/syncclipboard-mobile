/**
 * Clipboard Proxy
 * 剪贴板代理 - 在 Android 后台时通过 Shizuku 或悬浮窗获取剪贴板，其他情况直接调用 expo-clipboard
 *
 * 优先级：Shizuku > 悬浮窗 > 直接调用
 *
 * 当启用后台同步+悬浮窗模式时，悬浮窗按需显示（不可见的 1px 窗口），
 * 每次读取剪贴板时只是 focus 到悬浮窗读取后 unfocus，而非反复创建/销毁。
 * 若持续 10 秒无后台剪贴板调用，释放剪贴板占用；保活仍需要时保留共享窗口。
 */

import * as Clipboard from 'expo-clipboard';
import * as overlayModule from 'clipboard-overlay';
import * as shizukuModule from 'shizuku-clipboard';
import { Platform } from 'react-native';
import { configService } from '@/services/ConfigService';
import { acquireClipboardOverlay, dismissClipboardOverlay } from '../services/OverlayRuntime';
import { nativeSaveClipboardImageToFile } from 'native-util';

/** 释放剪贴板对共享悬浮窗的占用。 */
export async function dismissOverlay(): Promise<void> {
  await dismissClipboardOverlay();
}

/**
 * 判断是否应该使用 Shizuku 获取剪贴板
 * 条件：Android + 设置启用 + Shizuku 可用且有权限
 * Shizuku 优先级高于悬浮窗
 */
async function shouldUseShizuku(): Promise<boolean> {
  if (Platform.OS !== 'android' || !shizukuModule) return false;
  const config = await configService.getConfig();
  if (!(config?.enableShizukuClipboard ?? false)) return false;
  if (!shizukuModule.isShizukuAvailable()) return false;
  if (!shizukuModule.hasShizukuPermission()) return false;
  return true;
}

/** Shizuku 剪贴板事件模式与读取模式使用相同的启用条件。 */
export async function isShizukuClipboardEnabled(): Promise<boolean> {
  return shouldUseShizuku();
}

/**
 * 获取剪贴板文本
 */
export async function getStringAsync(options?: Clipboard.GetStringOptions): Promise<string> {
  if (await shouldUseShizuku()) {
    try {
      const result = await shizukuModule!.getStringViaShizuku();
      if (result && result.length > 0) return result;
      console.warn('[ClipboardProxy] Shizuku getStringAsync returned empty, falling back');
    } catch (e) {
      console.warn('[ClipboardProxy] Shizuku getStringAsync failed, falling back:', e);
    }
  }
  const releaseOverlay = await acquireClipboardOverlay();
  if (releaseOverlay) {
    try {
      const result = await overlayModule!.getStringViaOverlay();
      if (result && result.length > 0) return result;
      console.warn('[ClipboardProxy] Overlay getStringAsync returned empty, falling back');
    } catch (e) {
      console.warn('[ClipboardProxy] Overlay getStringAsync failed, falling back:', e);
    } finally {
      await releaseOverlay();
    }
  }
  return Clipboard.getStringAsync(options);
}

/**
 * 设置剪贴板文本
 */
export async function setStringAsync(
  text: string,
  options?: Clipboard.SetStringOptions
): Promise<boolean> {
  return Clipboard.setStringAsync(text, options);
}

/**
 * 检查剪贴板是否有文本
 */
export async function hasStringAsync(): Promise<boolean> {
  if (await shouldUseShizuku()) {
    try {
      return await shizukuModule!.hasStringViaShizuku();
    } catch (e) {
      console.warn('[ClipboardProxy] Shizuku hasStringAsync failed, falling back:', e);
    }
  }
  const releaseOverlay = await acquireClipboardOverlay();
  if (releaseOverlay) {
    try {
      return await overlayModule!.hasStringViaOverlay();
    } catch (e) {
      console.warn('[ClipboardProxy] Overlay hasStringAsync failed, falling back:', e);
    } finally {
      await releaseOverlay();
    }
  }
  return Clipboard.hasStringAsync();
}

/**
 * 检查剪贴板是否有图片
 */
export async function hasImageAsync(): Promise<boolean> {
  if (await shouldUseShizuku()) {
    try {
      return await shizukuModule!.hasImageViaShizuku();
    } catch (e) {
      console.warn('[ClipboardProxy] Shizuku hasImageAsync failed, falling back:', e);
    }
  }
  const releaseOverlay = await acquireClipboardOverlay();
  if (releaseOverlay) {
    try {
      return await overlayModule!.hasImageViaOverlay();
    } catch (e) {
      console.warn('[ClipboardProxy] Overlay hasImageAsync failed, falling back:', e);
    } finally {
      await releaseOverlay();
    }
  }
  return Clipboard.hasImageAsync();
}

/**
 * 获取剪贴板图片（旧接口，返回 base64）
 */
export async function getImageAsync(
  options: Clipboard.GetImageOptions
): Promise<Clipboard.ClipboardImage | null> {
  const releaseOverlay = await acquireClipboardOverlay();
  if (releaseOverlay) {
    try {
      const result = await overlayModule!.getImageViaOverlay();
      if (result) {
        return {
          data: result.data,
          size: result.size,
        };
      }
      return null;
    } catch (e) {
      console.warn('[ClipboardProxy] Overlay getImageAsync failed, falling back:', e);
    } finally {
      await releaseOverlay();
    }
  }
  return Clipboard.getImageAsync(options);
}

/**
 * 获取剪贴板图片并直接保存到文件（不经过 JS 内存）
 * @param destFileUri 目标文件 URI（file:// 格式）
 * @returns 成功返回 true，剪贴板无图片或失败返回 false
 */
export async function saveImageToFileAsync(
  destDirPath: string
): Promise<{ filePath: string; mimeType: string } | null> {
  const releaseOverlay = await acquireClipboardOverlay();
  if (releaseOverlay) {
    try {
      const result = await overlayModule!.saveImageToFileViaOverlay(destDirPath);
      if (result) return { filePath: result.filePath, mimeType: result.mimeType };
      // fallback if overlay failed
    } catch (e) {
      console.warn('[ClipboardProxy] Overlay saveImageToFileAsync failed, falling back:', e);
    } finally {
      await releaseOverlay();
    }
  }
  // 前台模式：使用 native-util 直接读取系统剪贴板并写入文件
  if (Platform.OS === 'android') {
    const result = await nativeSaveClipboardImageToFile(destDirPath);
    return result ? { filePath: result.filePath, mimeType: result.mimeType } : null;
  }
  return null;
}

/**
 * 设置剪贴板图片
 */
export async function setImageAsync(base64Image: string): Promise<void> {
  return Clipboard.setImageAsync(base64Image);
}
