/**
 * 前台界面与 Headless JS 共用的后台任务管理器。
 * 启停、配置变化和 AppState 切换统一串行处理；未启动时不响应配置通知。
 */

import { smsForwardingTask } from './SmsForwardingTask';
import { shizukuRecoveryTask } from './ShizukuRecoveryTask';
import { foregroundServiceTask } from './ForegroundServiceTask';
import { historySyncTask } from './HistorySyncTask';
import { clipboardMonitorTask } from './ClipboardMonitorTask';
import { historyTrackerTask } from './HistoryTrackerTask';
import { clipboardSyncTask } from './ClipboardSyncTask';
import { remoteClipboardMonitorTask } from './RemoteClipboardMonitorTask';
import { networkAutoSwitchTask } from './NetworkAutoSwitchTask';
import { configService } from '../services/ConfigService';
import { backgroundRuntimeState } from '../services/BackgroundRuntimeState';
import { AppState, Platform } from 'react-native';
import { LongRunningTaskCoordinator } from './LongRunningTaskCoordinator';

class LongRunningTaskManager extends LongRunningTaskCoordinator {
  constructor() {
    let foreground = AppState.currentState === 'active';
    super(
      async () => ({
        foreground: Platform.OS === 'ios' ? foreground : AppState.currentState === 'active',
        backgroundEnabled:
          Platform.OS === 'android' &&
          !backgroundRuntimeState.isTempDisabled() &&
          !!(await configService.getConfig()).enableBackgroundTasks,
      }),
      (name, error) => console.error(`[LongRunningTaskManager] Task "${name}" failed:`, error)
    );
    configService.subscribe(() => this.requestRefresh(true));
    backgroundRuntimeState.subscribe(() => this.requestRefresh(true));
    AppState.addEventListener('change', (state) => {
      if (Platform.OS === 'ios') {
        // 系统授权弹窗会暂时进入 inactive，仍属于同一段前台会话。
        if (state !== 'background' && state !== 'active') return;
        const active = state === 'active';
        if (foreground === active) return;
        foreground = active;
        this.requestRefresh(false, active);
      } else {
        this.requestRefresh();
      }
    });
  }

  private requestRefresh(configChanged = false, foreground?: boolean): void {
    this.refresh(configChanged, foreground).catch((error) => {
      console.error('[LongRunningTaskManager] Failed to reconcile tasks:', error);
    });
  }
}

export const longRunningTaskManager = new LongRunningTaskManager();

// Android 支持后台任务；iOS 的共享同步任务只在前台会话内运行。
if (Platform.OS === 'android') {
  // 网络选择与同步回调先于监听器启动，保证 Headless 冷启动也能收到首次变化。
  longRunningTaskManager.register(networkAutoSwitchTask, true);
  longRunningTaskManager.register(clipboardSyncTask);
  longRunningTaskManager.register(smsForwardingTask, true);
  // 历史订阅必须先就绪，才能接住监听器启动时发出的首条内容。
  longRunningTaskManager.register(historyTrackerTask, true);
  longRunningTaskManager.register(clipboardMonitorTask, true);
  longRunningTaskManager.register(remoteClipboardMonitorTask, true);
  longRunningTaskManager.register(historySyncTask, true);
  longRunningTaskManager.register(foregroundServiceTask);
  longRunningTaskManager.register(shizukuRecoveryTask);
} else if (Platform.OS === 'ios') {
  longRunningTaskManager.register(clipboardSyncTask);
  longRunningTaskManager.register(clipboardMonitorTask);
  longRunningTaskManager.register(remoteClipboardMonitorTask);
}
