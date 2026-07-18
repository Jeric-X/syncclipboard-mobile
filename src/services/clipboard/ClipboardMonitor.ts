/**
 * Clipboard Monitor
 * 剪贴板监听器 - 监听剪贴板内容变化
 */

import { AppState, Platform } from 'react-native';
import { LocalClipboard } from './LocalClipboard';
import { ClipboardContent, ClipboardChangeCallback, ClipboardMonitorOptions } from '@/types';
import { setTimer, clearTimer } from 'native-timer';
import { subscribeToPrimaryClipChanges } from 'shizuku-clipboard';
import { isShizukuClipboardEnabled } from '@/utils/clipboardProxy';

/**
 * 剪贴板监听器类
 */
export class ClipboardMonitor {
  private clipboardManager: LocalClipboard;
  private callbacks: Set<ClipboardChangeCallback> = new Set();
  private isMonitoring: boolean = false;
  private pollingTimerTag: string | null = null;
  private nativeClipboardListenerCleanup: (() => Promise<void>) | null = null;
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
      onBeforeCopy: () => this.pauseMonitoring(),
      onAfterCopy: () => this.resumeMonitoring(),
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
   * 开始剪贴板监控。
   */
  async start(): Promise<void> {
    if (this.isMonitoring) {
      console.warn('[ClipboardMonitor] Already monitoring');
      return;
    }

    this.isMonitoring = true;
    await this.startMonitoring();

    console.log('[ClipboardMonitor] Started monitoring');
  }

  /**
   * 启动或恢复剪贴板监控传输层，不检查当前是否已处于监控状态。
   */
  async startMonitoring(): Promise<void> {
    // 事件监听在非 Android 平台会直接返回 false，统一回退至轮询。
    const eventListening = await this.startNativeClipboardListener();
    if (!eventListening) this.startPolling();
    void this.checkClipboard();
  }

  /**
   * 停止监听剪贴板变化
   */
  async stop(): Promise<void> {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;

    // 停止轮询
    await this.stopMonitoring();

    console.log('[ClipboardMonitor] Stopped monitoring');
  }

  async stopMonitoring(): Promise<void> {
    // 停止轮询与事件监听
    this.checkGeneration++;
    this.stopPolling();
    await this.stopNativeClipboardListener();
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
    console.log('[ClipboardMonitor] Using polling mode');

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

  private async startNativeClipboardListener(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    if (this.nativeClipboardListenerCleanup) return true;

    try {
      if (!(await isShizukuClipboardEnabled())) {
        return false;
      }
      const cleanup = await subscribeToPrimaryClipChanges(
        () => {
          console.log('[ClipboardMonitor] Shizuku primary-clip event received');
          // 系统回调只表示“可能变更”；读取并使用既有哈希逻辑去重。
          void this.checkClipboard();
        },
        () => {
          void this.fallbackToPollingAfterNativeListenerLoss();
        }
      );
      if (!cleanup) {
        return false;
      }
      this.nativeClipboardListenerCleanup = cleanup;
      this.stopPolling();
      console.log('[ClipboardMonitor] Using Shizuku primary-clip event listener');
      return true;
    } catch (e) {
      console.warn('[ClipboardMonitor] Failed to start Shizuku event listener:', e);
      return false;
    }
  }

  private async stopNativeClipboardListener(): Promise<void> {
    const cleanup = this.nativeClipboardListenerCleanup;
    this.nativeClipboardListenerCleanup = null;
    if (!cleanup) return;
    try {
      await cleanup();
    } catch (e) {
      console.warn('[ClipboardMonitor] Failed to stop Shizuku event listener:', e);
    }
  }

  private async fallbackToPollingAfterNativeListenerLoss(): Promise<void> {
    await this.stopNativeClipboardListener();
    if (this.isMonitoring && !this.pollingTimerTag) {
      console.warn('[ClipboardMonitor] Shizuku listener unavailable; falling back to polling');
      this.startPolling();
    }
  }

  /** 配置或 Shizuku 授权变化后，切换事件模式与轮询兜底。 */
  async refreshListeningMode(): Promise<void> {
    if (!this.isMonitoring || Platform.OS !== 'android') return;

    const shouldUseEvents = await isShizukuClipboardEnabled();
    if (shouldUseEvents) {
      if (await this.startNativeClipboardListener()) return;
    } else {
      await this.stopNativeClipboardListener();
    }

    if (!this.pollingTimerTag) this.startPolling();
  }

  /**
   * 检查剪贴板内容
   */
  private async checkClipboard(): Promise<void> {
    if (!this.isMonitoring) return;
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
  async handleBackground(): Promise<void> {
    if (!this._isBgRunningEnabled()) {
      console.log('[ClipboardMonitor] Background upload disabled, pausing monitoring');
      await this.stopMonitoring();
    }
  }

  /**
   * App 从后台恢复前台时由外部（ClipboardMonitorTask.onForeground）调用。
   * 立即触发一次检查；只有轮询计时器和事件监听都不存在时才恢复监控。
   */
  handleForeground(): void {
    if (this.isMonitoring) {
      void this.checkClipboard();
      if (!this.pollingTimerTag && !this.nativeClipboardListenerCleanup) {
        void this.startMonitoring();
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
   * 临时暂停整个监控，不改变 isMonitoring 状态。
   * 用于程序内写入剪贴板期间停止轮询并注销 Shizuku 事件。
   */
  async pauseMonitoring(): Promise<void> {
    await this.stopMonitoring();
  }

  /**
   * 恢复被 pauseMonitoring 暂停的整个监控。
   * 优先重新注册 Shizuku 事件；不支持时恢复轮询计时器。
   * 同时立即触发一次检查，不必等待下一个周期。
   * 后台且后台上传未启用时，不恢复监控（避免后台写入剪贴板后误重启）。
   */
  async resumeMonitoring(): Promise<void> {
    if (!this.isMonitoring) return;

    // 后台且后台上传未启用时，不恢复任何监控。
    const currentState = AppState.currentState;
    if (
      (currentState === 'background' || currentState === 'inactive') &&
      !this._isBgRunningEnabled()
    ) {
      return;
    }

    await this.startMonitoring();
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
