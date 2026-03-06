/**
 * NativeUtilModule – file copy wrapper (Android Only)
 * 利用 NativeUtilModule 中注册的文件操作方法，提供不经过 JS 内存的流式文件拷贝。
 */

import { NativeModules, Platform } from 'react-native';

interface NativeFileModuleInterface {
  copyFile(srcUri: string, destUri: string): Promise<void>;
}

const _module: NativeFileModuleInterface | null =
  Platform.OS === 'android' ? (NativeModules.NativeUtilModule ?? null) : null;

/** 原生流式文件拷贝是否可用（仅 Android） */
export const isNativeCopyAvailable = _module !== null;

/**
 * 将 srcUri 流式拷贝到 destUri，4 MB 分块，不把文件读入 JS 内存。
 * destUri 可以是 SAF content:// URI 或普通 file:// URI。
 */
export async function nativeCopyFile(srcUri: string, destUri: string): Promise<void> {
  if (!_module) {
    throw new Error('NativeFileModule (HashModule.copyFile) is not available on this platform');
  }
  await _module.copyFile(srcUri, destUri);
}
