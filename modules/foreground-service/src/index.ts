import { Platform } from 'react-native';
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

const MODULE_NAME = 'ForegroundServiceModule';

interface ForegroundServiceModuleType {
  startService(): boolean;
  stopService(): boolean;
  updateNotification(content: string): boolean;
  isRunning(): boolean;
  cancelRestartNotification(): boolean;
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

export function cancelRestartNotification(): boolean {
  if (NativeModule) {
    return NativeModule.cancelRestartNotification();
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

/** 当前原生服务会话；无服务或不支持的平台返回 null。 */
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

/** 服务销毁时结束对应的 Headless JS 任务。 */
export function addSessionStoppedListener(
  listener: (event: { sessionId: string }) => void
): EventSubscription | null {
  return NativeModule?.addListener('onSessionStopped', listener) ?? null;
}
