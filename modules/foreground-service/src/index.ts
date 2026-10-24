import { Platform } from 'react-native';
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

const MODULE_NAME = 'ForegroundServiceModule';

interface ForegroundServiceModuleType {
  setTileRecoveryEnabled(enabled: boolean): void;
  setStickyEnabled(enabled: boolean): void;
  startHeadlessRuntime(): Promise<string | null>;
  finishHeadlessRuntime(sessionId: string): Promise<void>;
  startService(): boolean;
  stopService(): boolean;
  updateNotification(content: string): boolean;
  isRunning(): boolean;
  getSessionId(): string | null;
  getStopReason(): string | null;
  clearStopReason(): void;
  markSessionReady(sessionId: string): void;
  addListener(
    eventName: string,
    listener: (event: { sessionId: string }) => void
  ): EventSubscription;
}

const NativeModule: ForegroundServiceModuleType | null =
  Platform.OS === 'android' ? requireNativeModule(MODULE_NAME) : null;

export function startService(): boolean {
  if (NativeModule) {
    return NativeModule.startService();
  }
  return false;
}

export function stopService(): boolean {
  if (NativeModule) {
    return NativeModule.stopService();
  }
  return false;
}

export function updateNotification(content: string): boolean {
  if (NativeModule) {
    return NativeModule.updateNotification(content);
  }
  return false;
}

export function isRunning(): boolean {
  if (NativeModule) {
    return NativeModule.isRunning();
  }
  return false;
}

export function addStopListener(listener: () => void): EventSubscription | null {
  if (NativeModule) {
    return NativeModule.addListener('onStopRequested', listener);
  }
  return null;
}

export function addTempStopListener(listener: () => void): EventSubscription | null {
  if (NativeModule) {
    return NativeModule.addListener('onTempStopRequested', listener);
  }
  return null;
}

/** 独立确保进程内唯一的 Headless 会话；不等待 JS 初始化，也不要求前台服务已启动。 */
export async function startHeadlessRuntime(): Promise<string | null> {
  return NativeModule ? NativeModule.startHeadlessRuntime() : null;
}

/** JS 会话退出时确认释放原生占用；过期 ID 不影响当前会话。 */
export async function finishHeadlessRuntime(sessionId: string): Promise<void> {
  await NativeModule?.finishHeadlessRuntime(sessionId);
}

/** 当前进程级 Headless 会话，可能先于前台服务存在。 */
export function getSessionId(): string | null {
  return NativeModule?.getSessionId() ?? null;
}

/** 冷启动时补偿 JS 尚未就绪期间的通知操作。 */
export function getStopReason(): string | null {
  return NativeModule?.getStopReason() ?? null;
}

/** 配置落盘或用户回前台后确认已处理原生停止标记。 */
export function clearStopReason(): void {
  NativeModule?.clearStopReason();
}

/** 同步任务初始化完成，释放原生启动阶段的唤醒锁。 */
export function markSessionReady(sessionId: string): void {
  NativeModule?.markSessionReady(sessionId);
}

/** 监听进程级会话结束，包括 Headless 主动退出或初始化失败。 */
export function addSessionStoppedListener(
  listener: (event: { sessionId: string }) => void
): EventSubscription | null {
  return NativeModule?.addListener('onSessionStopped', listener) ?? null;
}

/** 保存磁贴恢复许可，供 JS 尚未启动时的原生入口读取。 */
export function setTileRecoveryEnabled(enabled: boolean): void {
  NativeModule?.setTileRecoveryEnabled(enabled);
}

/** 保存前台服务的重建策略，并通知正在运行的服务更新系统记录。 */
export function setStickyEnabled(enabled: boolean): void {
  NativeModule?.setStickyEnabled(enabled);
}
