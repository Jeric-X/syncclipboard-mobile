/**
 * Clipboard Monitor
 * 剪贴板监听器 - 监听剪贴板内容变化
 */

import { AppState, Platform } from 'react-native';
import { LocalClipboard } from './LocalClipboard';
import { ClipboardContent, ClipboardChangeCallback, ClipboardMonitorOptions } from '@/types';
import { setTimer, clearTimer } from 'native-timer';

/**
 * 剪贴板监听器类
 */
export class ClipboardMonitor {
  private clipboardManager: LocalClipboard;
  private callbacks: Set<ClipboardChangeCallback> = new Set();
  private isMonitoring: boolean = false;
  private pollingTimerTag: string | null = null;
  private lastContent: ClipboardContent | null = null;

  /**
   * 注入的回调集合，用于查询“后台运行是否需要持续”。
   * 只要任意一个回调返回 true，轮询就不会因进入后台而暂停。
   * 如果集合为空，默认视为未启用。
   */
  private readonly _bgRunningCheckers: Set<() => boolean> = new Set();

  // 配置选项
  private options: Required<ClipboardMonitorOptions> = {
    pollingInterval: 1000, // iOS 默认 1 秒轮询
  };

  private isChecking: boolean = false;
  private checkGeneration: number = 0;

  constructor(clipboardManager: LocalClipboard, options?: ClipboardMonitorOptions) {
    this.clipboardManager = clipboardManager;

    // 注册复制生命周期回调，避免循环引用
    clipboardManager.registerCopyLifecycleCallbacks({
      onBeforeCopy: () => this.pausePolling(),
      onAfterCopy: () => this.resumePolling(),
    });

    if (options) {
      this.options = { ...this.options, ...options };
    }
  }

  /**
   * 添加一个“后台运行检测函数”。
   * 运行时只要任意一个检测函数返回 true，轮询就不会因进入后台而暂停。
   * 应在服务启动时由外部调用。
   */
  addBackgroundRunningChecker(fn: () => boolean): void {
    this._bgRunningCheckers.add(fn);
  }

  removeBackgroundRunningChecker(fn: () => boolean): void {
    this._bgRunningCheckers.delete(fn);
  }

  /**
   * 开始监听剪贴板变化
   */
  async start(): Promise<void> {
    if (this.isMonitoring) {
      console.warn('[ClipboardMonitor] Already monitoring');
      return;
    }

    this.isMonitoring = true;

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

    this.pollingTimerTag = setTimer(
      () => this.checkClipboard(),
      this.options.pollingInterval,
      'clipboard_monitor'
    );
  }

  /**
   * 停止轮询
   */
  private stopPolling(): void {
    if (this.pollingTimerTag) {
      clearTimer(this.pollingTimerTag);
      this.pollingTimerTag = null;
    }
  }

  /**
   * 检查剪贴板内容
   */
  private async checkClipboard(): Promise<void> {
    // 互斥锁：如果上一次检查还在进行中（大图片 hash 计算耗时），跳过本次
    if (this.isChecking) return;
    this.isChecking = true;
    const gen = this.checkGeneration;
    try {
      const content = await this.clipboardManager.getClipboardContent();

      // 如果在 getClipboardContent 期间 setLastContent 被调用，丢弃本次结果
      if (gen !== this.checkGeneration) return;

      if (!content) {
        // console.log('[ClipboardMonitor] Poll: clipboard is empty');
        return;
      }

      // 检查内容是否发生变化
      if (this.hasContentChanged(content)) {
        this.lastContent = content;
        this.notifyCallbacks(content);
      }
    } catch (error) {
      console.error('[ClipboardMonitor] Failed to check clipboard:', error);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * 检查内容是否发生变化
   */
  private hasContentChanged(newContent: ClipboardContent): boolean {
    if (!this.lastContent) {
      return true;
    }

    // 优先使用 localClipboardHash 比较（用于本地变化检测）
    if (newContent.localClipboardHash && this.lastContent.localClipboardHash) {
      return newContent.localClipboardHash !== this.lastContent.localClipboardHash;
    }

    // 回退到 profileHash 比较
    if (newContent.profileHash && this.lastContent.profileHash) {
      return newContent.profileHash !== this.lastContent.profileHash;
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
   * 使用 native-timer 替代 JS setTimeout，确保 Android 后台也能可靠触发
   */
  private notifyCallbacks(content: ClipboardContent): void {
    this.callbacks.forEach((callback) => {
      try {
        callback(content);
      } catch (error) {
        console.error('[ClipboardMonitor] Callback error:', error);
      }
    });
  }

  private _isBgRunningEnabled(): boolean {
    return Array.from(this._bgRunningCheckers).some((fn) => fn());
  }

  /**
   * App 进入后台时由外部（ClipboardMonitorTask.onBackground）调用。
   * 若后台上传未启用，暂停轮询以节省资源。
   */
  handleBackground(): void {
    if (!this._isBgRunningEnabled()) {
      console.log('[ClipboardMonitor] Background upload disabled, pausing polling');
      this.stopPolling();
    }
  }

  /**
   * App 从后台恢复前台时由外部（ClipboardMonitorTask.onForeground）调用。
   * 立即触发一次检查并（重）启轮询计时器。
   */
  handleForeground(): void {
    if (this.isMonitoring) {
      void this.checkClipboard();
      if (!this.pollingTimerTag) {
        this.startPolling();
      }
    }
  }

  /**
   * 手动触发一次检查
   */
  async triggerCheck(): Promise<void> {
    await this.checkClipboard();
  }

  /**
   * 获取上次已知的本地剪贴板内容缓存（不触发系统 API 读取）
   */
  getLastContent(): ClipboardContent | null {
    return this.lastContent;
  }

  /**
   * 手动更新上次已知内容，防止监听器将外部设置的剪贴板内容误判为用户新复制
   */
  async setLastContent(content: ClipboardContent): Promise<void> {
    this.checkGeneration++; // 使正在进行的 checkClipboard 结果失效
    this.lastContent = content;
  }

  /**
   * 临时暂停轮询计时器，不改变 isMonitoring 状态。
   * 用于"程序内写入剪贴板"期间防止监听器误触发，配合 resumePolling 使用。
   */
  pausePolling(): void {
    this.stopPolling();
  }

  /**
   * 恢复被 pausePolling 暂停的轮询计时器。
   * 会重置计时器间隔，下次轮询从调用此方法起重新计时。
   * 同时立即触发一次检查，不必等待下一个周期。
   * 后台且后台上传未启用时，不恢复轮询（避免后台写入剪贴板后误重启轮询）。
   */
  resumePolling(): void {
    if (!this.isMonitoring) return;

    // 后台且后台上传未启用时，不恢复轮询
    const currentState = AppState.currentState;
    if (
      (currentState === 'background' || currentState === 'inactive') &&
      !this._isBgRunningEnabled()
    ) {
      return;
    }

    this.startPolling();
    // 立即触发一次检查，不等待周期计时器
    this.checkClipboard().catch(() => {});
  }

  /**
   * 更新轮询间隔
   * 如果正在监听，会重新启动轮询计时器
   */
  updatePollingInterval(interval: number): void {
    this.options.pollingInterval = interval;
    if (this.isMonitoring && this.pollingTimerTag) {
      this.startPolling();
    }
  }

  /**
   * 获取当前轮询间隔
   */
  getPollingInterval(): number {
    return this.options.pollingInterval;
  }

  /**
   * 重置监听器状态
   */
  reset(): void {
    this.lastContent = null;
  }
}

// 创建默认实例
import { localClipboard } from './LocalClipboard';
export const clipboardMonitor = new ClipboardMonitor(localClipboard);
