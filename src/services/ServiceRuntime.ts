/**
 * 与 React 组件无关的服务运行时入口。
 * Android Activity 只请求 Headless 会话，由 Headless 统一初始化任务。
 */
import { AppState, Platform } from 'react-native';
import { runtimeReadiness } from '../utils/runtimeReadiness';
import * as ForegroundService from 'foreground-service';
import { configService } from './ConfigService';
import { backgroundRuntimeState } from './BackgroundRuntimeState';
import { longRunningTaskManager } from '../longRunningTask/LongRunningTaskManager';
import { useSettingsStore } from '../stores/settingsStore';
import { initLogger } from '../utils/Logger';
import { dismissOverlay } from '../utils/clipboardProxy';
import { logStartupPoint, measureStartup } from '../utils/startupTiming';
import { getStartupElapsedMs } from '../utils/startupClock';
import { prepareAppFoundation } from './AppFoundation';

let initializing: Promise<void> | null = null;
let installed = false;

/** Android 只由 Headless 任务调用；其他平台保留直接初始化入口。 */
export function startServiceRuntime(): Promise<void> {
  if (initializing) return initializing;
  initializing = (async () => {
    const entryUptimeMs = getStartupElapsedMs();
    try {
      initLogger();
    } catch (error) {
      console.error('[ServiceRuntime] Logger initialization failed:', error);
    }
    logStartupPoint('runtime.entry', {
      entryUptimeMs: Math.round(entryUptimeMs),
      loggerInitMs: Math.round(getStartupElapsedMs() - entryUptimeMs),
      appState: AppState.currentState,
      sessionId: ForegroundService.getSessionId(),
    });
    await measureStartup('runtime.loadConfig', () => configService.getConfig());
    await measureStartup('runtime.foundation', prepareAppFoundation);
    const stopReason = await applyStopPolicy(false);
    const config = await configService.getConfig();
    useSettingsStore.setState({ config, isLoaded: true });
    logStartupPoint('runtime.configApplied', { stopReason });
    await measureStartup('runtime.startTasks', () => longRunningTaskManager.startAll());
    logStartupPoint('runtime.ready');
  })().finally(() => {
    initializing = null;
  });
  return initializing;
}

/** 前台恢复先处理停止偏好，不直接初始化或重复启动后台任务。 */
async function applyStopPolicy(foregroundEntry: boolean): Promise<string | null> {
  const stopReason = ForegroundService.getStopReason();
  if (stopReason === 'stop') {
    await configService.updateConfig({ enableBackgroundTasks: false });
    if (ForegroundService.getStopReason() === stopReason) ForegroundService.clearStopReason();
  }
  if (foregroundEntry && ForegroundService.getStopReason() === stopReason) {
    ForegroundService.clearStopReason();
  }
  if (ForegroundService.getStopReason()) {
    backgroundRuntimeState.setTempDisabled(true);
  } else if (foregroundEntry) {
    backgroundRuntimeState.setTempDisabled(false);
  }
  return stopReason;
}

let requesting: Promise<void> | null = null;
let resuming: Promise<void> | null = null;

/** UI 请求会话并等待就绪；原生创建调用本身不等待 JS，避免相互等待。 */
export async function requestServiceRuntime(foregroundEntry = false): Promise<void> {
  if (foregroundEntry) {
    if (!resuming) {
      resuming = (async () => {
        await initializing;
        await configService.getConfig();
        await applyStopPolicy(true);
      })().finally(() => {
        resuming = null;
      });
    }
    await resuming;
  }
  if (Platform.OS !== 'android') return startServiceRuntime();
  if (!requesting) {
    requesting = (async () => {
      const subscription = ForegroundService.addSessionStoppedListener(({ sessionId }) =>
        runtimeReadiness.end(sessionId)
      );
      try {
        const sessionId = await ForegroundService.startHeadlessRuntime();
        if (!sessionId || ForegroundService.getSessionId() !== sessionId) {
          throw new Error('Headless runtime could not be started');
        }
        await runtimeReadiness.wait(sessionId);
      } finally {
        subscription?.remove();
      }
    })().finally(() => {
      requesting = null;
    });
  }
  await requesting;
}

/** 从 index 安装进程级前台入口；短信 Headless 加载 bundle 时不会误启同步。 */
export function installServiceRuntime(): void {
  if (installed) return;
  installed = true;
  const onForeground = (): void => {
    if (AppState.currentState !== 'active') return;
    requestServiceRuntime(true).catch((error) =>
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
