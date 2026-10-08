/**
 * 前台界面与 Headless JS 共用的后台任务管理器。
 * 启停、配置变化和 AppState 切换统一串行处理；未启动时不响应配置通知。
 */

import { smsForwardingTask } from './SmsForwardingTask';
import { foregroundServiceTask } from './ForegroundServiceTask';
import { historySyncTask } from './HistorySyncTask';
import { clipboardMonitorTask } from './ClipboardMonitorTask';
import { historyTrackerTask } from './HistoryTrackerTask';
import { clipboardSyncTask } from './ClipboardSyncTask';
import { remoteClipboardMonitorTask } from './RemoteClipboardMonitorTask';
import { heartbeatTask } from './HeartbeatTask';
import { networkAutoSwitchTask } from './NetworkAutoSwitchTask';
import { configService } from '../services/ConfigService';
import { backgroundRuntimeState } from '../services/BackgroundRuntimeState';
import { AppState } from 'react-native';
import { LongRunningTaskCoordinator } from '../utils/longRunningTaskCoordinator';

class LongRunningTaskManager extends LongRunningTaskCoordinator {
  constructor() {
    super(
      async () => ({
        foreground: AppState.currentState === 'active',
        backgroundEnabled:
          !backgroundRuntimeState.isTempDisabled() &&
          !!(await configService.getConfig()).enableBackgroundTasks,
      }),
      (name, error) => console.error(`[LongRunningTaskManager] Task "${name}" failed:`, error)
    );
    configService.subscribe(() => this.requestRefresh(true));
    backgroundRuntimeState.subscribe(() => this.requestRefresh(true));
    AppState.addEventListener('change', () => this.requestRefresh());
  }

  private requestRefresh(configChanged = false): void {
    this.refresh(configChanged).catch((error) => {
      console.error('[LongRunningTaskManager] Failed to reconcile tasks:', error);
    });
  }
}

export const longRunningTaskManager = new LongRunningTaskManager();

// 网络选择与同步回调先于监听器启动，保证 Headless 冷启动也能收到首次变化。
longRunningTaskManager.register(networkAutoSwitchTask, true);
longRunningTaskManager.register(clipboardSyncTask);
longRunningTaskManager.register(smsForwardingTask, true);
longRunningTaskManager.register(clipboardMonitorTask, true);
longRunningTaskManager.register(remoteClipboardMonitorTask, true);
longRunningTaskManager.register(historyTrackerTask, true);
longRunningTaskManager.register(historySyncTask, true);
longRunningTaskManager.register(heartbeatTask);
longRunningTaskManager.register(foregroundServiceTask);
