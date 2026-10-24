import { Platform } from 'react-native';
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

const MODULE_NAME = 'ShizukuClipboardModule';

interface ShizukuClipboardModuleInterface {
  setRecoveryEnabled(enabled: boolean, preserveStartupFailure: boolean): void;
  isShizukuAvailable(): boolean;
  hasShizukuPermission(): boolean;
  requestShizukuPermission(): boolean;
  getStringViaShizuku(): Promise<string>;
  hasStringViaShizuku(): Promise<boolean>;
  hasImageViaShizuku(): Promise<boolean>;
  getImageUriViaShizuku(): Promise<string | null>;
  startPrimaryClipChangedListener(): Promise<boolean>;
  stopPrimaryClipChangedListener(): Promise<void>;
  addListener(
    eventName:
      | 'onPrimaryClipChanged'
      | 'onPrimaryClipListenerUnavailable'
      | 'onPrimaryClipListenerAvailable',
    listener: () => void
  ): EventSubscription;
}

const NativeModule: ShizukuClipboardModuleInterface | null =
  Platform.OS === 'android' ? requireNativeModule(MODULE_NAME) : null;

/**
 * 检查 Shizuku 是否可用（已安装并运行中）
 */
export function isShizukuAvailable(): boolean {
  if (NativeModule) {
    return NativeModule.isShizukuAvailable();
  }
  return false;
}

/**
 * 检查是否已获取 Shizuku 权限
 */
export function hasShizukuPermission(): boolean {
  if (NativeModule) {
    return NativeModule.hasShizukuPermission();
  }
  return false;
}

/**
 * 请求 Shizuku 权限
 */
export function requestShizukuPermission(): boolean {
  if (NativeModule) {
    return NativeModule.requestShizukuPermission();
  }
  return false;
}

/**
 * 通过 Shizuku 获取剪贴板文本
 */
export async function getStringViaShizuku(): Promise<string> {
  if (NativeModule) {
    return NativeModule.getStringViaShizuku();
  }
  return '';
}

/**
 * 通过 Shizuku 检查剪贴板是否有文本
 */
export async function hasStringViaShizuku(): Promise<boolean> {
  if (NativeModule) {
    return NativeModule.hasStringViaShizuku();
  }
  return false;
}

/**
 * 通过 Shizuku 检查剪贴板是否有图片
 */
export async function hasImageViaShizuku(): Promise<boolean> {
  if (NativeModule) {
    return NativeModule.hasImageViaShizuku();
  }
  return false;
}

/**
 * 通过 Shizuku 获取剪贴板图片 URI
 */
export async function getImageUriViaShizuku(): Promise<string | null> {
  if (NativeModule) {
    return NativeModule.getImageUriViaShizuku();
  }
  return null;
}

/**
 * 订阅剪贴板及连接状态；暂时不可用时保留订阅用于重连，返回 null 表示平台不支持。
 */
export async function subscribeToPrimaryClipChanges(
  callback: () => void,
  onUnavailable?: () => void,
  onAvailable?: () => void
): Promise<(() => Promise<void>) | null> {
  if (!NativeModule) return null;

  const subscription = NativeModule.addListener('onPrimaryClipChanged', callback);
  let receivedStateEvent = false;
  const unavailableSubscription = NativeModule.addListener(
    'onPrimaryClipListenerUnavailable',
    () => {
      receivedStateEvent = true;
      onUnavailable?.();
    }
  );
  const availableSubscription = NativeModule.addListener('onPrimaryClipListenerAvailable', () => {
    receivedStateEvent = true;
    onAvailable?.();
  });
  try {
    const ready = await NativeModule.startPrimaryClipChangedListener();
    if (!receivedStateEvent) {
      if (ready) onAvailable?.();
      else onUnavailable?.();
    }
  } catch (error) {
    console.warn('[ShizukuClipboard] Listener unavailable; waiting for reconnection:', error);
    if (!receivedStateEvent) onUnavailable?.();
  }

  return async () => {
    subscription.remove();
    unavailableSubscription?.remove();
    availableSubscription?.remove();
    await NativeModule.stopPrimaryClipChangedListener();
  };
}

/** 独立守护主进程；不支持的平台静默忽略，授权与绑定由原生层处理。 */
export function setRecoveryEnabled(enabled: boolean, preserveStartupFailure = false): void {
  NativeModule?.setRecoveryEnabled(enabled, preserveStartupFailure);
}
