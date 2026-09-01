/**
 * SMS Upload Headless Task
 * 无头 JS 任务 — 在后台（无 UI）提取短信验证码并上传到服务器。
 * 由 SmsHeadlessTaskService (Native) 启动，不依赖 React Native 主界面线程。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { Platform } from 'react-native';
import { sha256 } from 'js-sha256';
import {
  extractVerificationCode as nativeExtractVerificationCode,
  startSmsUploadCountdown,
  updateSmsUploadNotification,
} from 'sms-forwarder';
import { getAPIClient } from '../services/ClientFactory';
import { networkAutoSwitchService } from '../services/NetworkAutoSwitchService';
import {
  SmsCodeUploader,
  type SmsCodeUploadRequest,
  type SmsCodeUploaderDependencies,
} from '../services/sms/SmsCodeUploader';
import { STORAGE_KEYS } from '../types/storage';
import type { AppConfig } from '../types/storage';
import { initLogger } from '../utils/Logger';

/** 从短信正文中提取验证码（调用 Native 正则）。 */
export function extractVerificationCode(body: string): string | null {
  try {
    return nativeExtractVerificationCode(body);
  } catch (error) {
    console.error('[SmsUploadTask] Native verification code extraction failed:', error);
    return null;
  }
}

async function loadConfig(): Promise<AppConfig | null> {
  const json = await AsyncStorage.getItem(STORAGE_KEYS.CONFIG);
  return json ? (JSON.parse(json) as AppConfig) : null;
}

function calculateHash(text: string): string {
  const hasher = sha256.create();
  hasher.update(text);
  return hasher.hex().toUpperCase();
}

const dependencies: SmsCodeUploaderDependencies = {
  now: () => Date.now(),
  sleep: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  log: (level, message) => {
    if (level === 'error') {
      console.error(message);
    } else if (level === 'warn') {
      console.warn(message);
    } else {
      console.info(message);
    }
  },
  extractVerificationCode: nativeExtractVerificationCode,
  copyToClipboard: async (code) => {
    await Clipboard.setStringAsync(code);
  },
  loadConfig,
  selectServerForCurrentNetworkOnce: () =>
    networkAutoSwitchService.selectServerForCurrentNetworkOnce(),
  getAPIClient,
  calculateHash,
  updateNotification: (text) => {
    updateSmsUploadNotification(text);
  },
  notifyUploadSucceeded: (code) => {
    startSmsUploadCountdown(code);
  },
};
const smsCodeUploader = new SmsCodeUploader(dependencies);

/** Headless JS 任务入口。 */
export default async function SmsUploadTask(taskData?: SmsCodeUploadRequest): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    initLogger();
  } catch (error) {
    // 文件日志初始化失败时保留 Logcat 线索，但不阻止验证码上传。
    console.error('[SmsUploadTask] stage=logging logger initialization failed', error);
  }
  await smsCodeUploader.upload(taskData);
}
