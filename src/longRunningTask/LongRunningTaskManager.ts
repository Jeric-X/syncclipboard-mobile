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
import { areBackgroundTasksEnabled } from '../utils/config';
import { AppState, Platform } from 'react-native';
import { LongRunningTaskCoordinator } from './LongRunningTaskCoordinator';

class LongRunningTaskManager extends LongRunningTaskCoordinator {
  constructor() {
    let foreground = AppState.currentState === 'active';
    super(
      async () => ({
        backgroundEnabled:
          !backgroundRuntimeState.isTempDisabled() &&
          areBackgroundTasksEnabled(await configService.getConfig()),
        foreground,
      }),
      (name, error) => console.error(`[LongRunningTaskManager] Task "${name}" failed:`, error)
    );
    configService.subscribe(() => this.requestRefresh(true));
    backgroundRuntimeState.subscribe(() => this.requestRefresh(true));
    AppState.addEventListener('change', (state) => {
      // iOS 的授权弹窗也会进入 inactive；只有真正退后台才结束本次前台会话。
      if (state === 'inactive') return;
      const active = state === 'active';
      if (foreground === active) return;
      foreground = active;
      if (!active) this.noteBackgroundTransition();
      this.requestRefresh();
    });
  }

  private requestRefresh(configChanged = false): void {
    this.refresh(configChanged).catch((error) => {
      console.error('[LongRunningTaskManager] Failed to reconcile tasks:', error);
    });
  }
}

export const longRunningTaskManager = new LongRunningTaskManager();

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
  // 退后台时同步服务退订；两个 monitor 根据注册的后台运行条件暂停或恢复监听。
  longRunningTaskManager.register(clipboardSyncTask);
  longRunningTaskManager.register(clipboardMonitorTask, true);
  longRunningTaskManager.register(remoteClipboardMonitorTask, true);
}
