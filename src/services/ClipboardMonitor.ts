/**
 * Clipboard Monitor
 * 剪贴板监听器 - 监听剪贴板内容变化
 */

import { AppState, AppStateStatus, Platform } from 'react-native';
import { ClipboardManager } from './ClipboardManager';
import { ClipboardContent, ClipboardChangeCallback, ClipboardMonitorOptions } from '@/types';

/**
 * 剪贴板监听器类
 */
export class ClipboardMonitor {
  private clipboardManager: ClipboardManager;
  private callbacks: Set<ClipboardChangeCallback> = new Set();
  private isMonitoring: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
  private lastContent: ClipboardContent | null = null;

  // 配置选项
  private options: Required<ClipboardMonitorOptions> = {
    pollingInterval: 1000, // iOS 默认 1 秒轮询
    stopOnBackground: true,
    debounceDelay: 300,
  };

  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(clipboardManager: ClipboardManager, options?: ClipboardMonitorOptions) {
    this.clipboardManager = clipboardManager;

    if (options) {
      this.options = { ...this.options, ...options };
    }
  }

  /**
   * 开始监听剪贴板变化
   */
  start(): void {
    if (this.isMonitoring) {
      console.warn('[ClipboardMonitor] Already monitoring');
      return;
    }

    this.isMonitoring = true;

    // 监听应用状态变化
    if (this.options.stopOnBackground) {
      this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    }

    // 开始轮询（iOS）或设置监听器（Android）
    if (Platform.OS === 'ios') {
      this.startPolling();
    } else if (Platform.OS === 'android') {
      this.startPolling(); // Android 也使用轮询作为备选方案
      // TODO: 实现原生 Android ClipboardManager 监听器
    }

    console.log('[ClipboardMonitor] Started monitoring');
  }

  /**
   * 停止监听剪贴板变化
   */
  stop(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;

    // 停止轮询
    this.stopPolling();

    // 取消应用状态监听
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    // 清除防抖计时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    console.log('[ClipboardMonitor] Stopped monitoring');
  }

  /**
   * 添加剪贴板变化回调
   */
  addCallback(callback: ClipboardChangeCallback): void {
    this.callbacks.add(callback);
  }

  /**
   * 移除剪贴板变化回调
   */
  removeCallback(callback: ClipboardChangeCallback): void {
    this.callbacks.delete(callback);
  }

  /**
   * 清除所有回调
   */
  clearCallbacks(): void {
    this.callbacks.clear();
  }

  /**
   * 检查是否正在监听
   */
  isActive(): boolean {
    return this.isMonitoring;
  }

  /**
   * 开始轮询
   */
  private startPolling(): void {
    this.stopPolling(); // 先停止现有轮询

    this.pollingInterval = setInterval(() => this.checkClipboard(), this.options.pollingInterval);
  }

  /**
   * 停止轮询
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * 检查剪贴板内容
   */
  private async checkClipboard(): Promise<void> {
    try {
      const content = await this.clipboardManager.getClipboardContent();

      if (!content) {
        return;
      }

      // 检查内容是否发生变化
      if (this.hasContentChanged(content)) {
        console.log('[ClipboardMonitor] ✓ Change detected, notifying callbacks');
        this.lastContent = content;
        this.notifyCallbacks(content);
      }
    } catch (error) {
      console.error('[ClipboardMonitor] Failed to check clipboard:', error);
    }
  }

  /**
   * 检查内容是否发生变化
   */
  private hasContentChanged(newContent: ClipboardContent): boolean {
    if (!this.lastContent) {
      return true;
    }

    // 优先使用 contentHash 比较（用于本地变化检测）
    if (newContent.contentHash && this.lastContent.contentHash) {
      return newContent.contentHash !== this.lastContent.contentHash;
    }

    // 回退到 profileHash 比较
    if (newContent.hash && this.lastContent.hash) {
      return newContent.hash !== this.lastContent.hash;
    }

    // 比较类型和文本
    if (newContent.type !== this.lastContent.type) {
      return true;
    }

    if (newContent.text !== this.lastContent.text) {
      return true;
    }

    return false;
  }

  /**
   * 通知所有回调（带防抖）
   */
  private notifyCallbacks(content: ClipboardContent): void {
    // 清除现有防抖计时器
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // 设置新的防抖计时器
    this.debounceTimer = setTimeout(() => {
      this.callbacks.forEach((callback) => {
        try {
          callback(content);
        } catch (error) {
          console.error('[ClipboardMonitor] Callback error:', error);
        }
      });
    }, this.options.debounceDelay);
  }

  /**
   * 处理应用状态变化
   */
  private handleAppStateChange = (nextAppState: AppStateStatus): void => {
    if (!this.options.stopOnBackground) {
      return;
    }

    if (nextAppState === 'active') {
      // 应用进入前台，开始监听
      if (this.isMonitoring && !this.pollingInterval) {
        this.startPolling();
      }
    } else if (nextAppState === 'background' || nextAppState === 'inactive') {
      // 应用进入后台，停止监听
      this.stopPolling();
    }
  };

  /**
   * 手动触发一次检查
   */
  async triggerCheck(): Promise<void> {
    await this.checkClipboard();
  }

  /**
   * 重置监听器状态
   */
  reset(): void {
    this.lastContent = null;
    this.clipboardManager.resetLastHash();
  }
}

// 创建默认实例
import { clipboardManager } from './ClipboardManager';
export const clipboardMonitor = new ClipboardMonitor(clipboardManager);
