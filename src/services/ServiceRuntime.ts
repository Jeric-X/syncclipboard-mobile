/**
 * 与 React 组件无关的服务运行时入口。
 * Activity 进入前台与原生 Headless 服务共享初始化和任务实例。
 */
import { AppState, Platform } from 'react-native';
import * as ForegroundService from 'foreground-service';
import { configService } from './ConfigService';
import { backgroundRuntimeState } from './BackgroundRuntimeState';
import { longRunningTaskManager } from '../longRunningTask/LongRunningTaskManager';
import { useSettingsStore } from '../stores/settingsStore';
import { initLogger } from '../utils/Logger';
import { dismissOverlay } from '../utils/clipboardProxy';

let initializing: Promise<void> | null = null;
let installed = false;

/** 同时到达的 UI/Headless 入口共享初始化；任务管理器进一步串行化启停。 */
export function startServiceRuntime(foregroundEntry = false): Promise<void> {
  if (initializing) {
    // 前台恢复若恰逢 Headless 初始化，仍需在其完成后处理暂停标记。
    return foregroundEntry ? initializing.then(() => startServiceRuntime(true)) : initializing;
  }
  initializing = (async () => {
    try {
      initLogger();
    } catch (error) {
      console.error('[ServiceRuntime] Logger initialization failed:', error);
    }
    await configService.getConfig();
    const stopReason = ForegroundService.getStopReason();
    if (stopReason === 'stop') {
      await configService.updateConfig({ enableBackgroundTasks: false });
      if (ForegroundService.getStopReason() === 'stop') ForegroundService.clearStopReason();
    }
    // 只有真实的前台入口才能解除临时暂停。Headless 在前台启动不能撤销用户刚点的停止。
    if (foregroundEntry && ForegroundService.getStopReason() === stopReason) {
      ForegroundService.clearStopReason();
    }
    if (ForegroundService.getStopReason()) {
      backgroundRuntimeState.setTempDisabled(true);
    } else if (foregroundEntry) {
      backgroundRuntimeState.setTempDisabled(false);
    }
    const config = await configService.getConfig();
    useSettingsStore.setState({ config, isLoaded: true });
    await longRunningTaskManager.startAll();
  })().finally(() => {
    initializing = null;
  });
  return initializing;
}

/** 从 index 安装进程级前台入口；短信 Headless 加载 bundle 时不会误启同步。 */
export function installServiceRuntime(): void {
  if (installed || Platform.OS !== 'android') return;
  installed = true;
  const onForeground = (): void => {
    if (AppState.currentState !== 'active') return;
    startServiceRuntime(true).catch((error) =>
      console.error('[ServiceRuntime] Startup failed:', error)
    );
  };
  AppState.addEventListener('change', onForeground);
  onForeground();
}

/** 无界面也无原生服务持有运行时后，释放所有 JS 监听、连接与悬浮窗。 */
export async function stopServiceRuntimeIfIdle(): Promise<void> {
  if (AppState.currentState === 'active' || ForegroundService.getSessionId()) return;
  await longRunningTaskManager.stopAll();
  await dismissOverlay();
}
