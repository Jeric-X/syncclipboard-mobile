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
import { ClipboardSyncTask } from './ClipboardSyncTask';
import { remoteClipboardMonitorTask } from './RemoteClipboardMonitorTask';
import { networkAutoSwitchTask } from './NetworkAutoSwitchTask';
import { configService } from '../services/ConfigService';
import { backgroundRuntimeState } from '../services/BackgroundRuntimeState';
import { AppState, Platform } from 'react-native';
import { LongRunningTaskCoordinator } from './LongRunningTaskCoordinator';

const supportsBackgroundTasks = Platform.OS === 'android';

class LongRunningTaskManager extends LongRunningTaskCoordinator {
  constructor() {
    let foreground = AppState.currentState === 'active';
    super(
      async () => ({
        foreground: foreground,
        backgroundEnabled:
          supportsBackgroundTasks &&
          !backgroundRuntimeState.isTempDisabled() &&
          !!(await configService.getConfig()).enableBackgroundTasks,
      }),
      (name, error) => console.error(`[LongRunningTaskManager] Task "${name}" failed:`, error)
    );
    configService.subscribe(() => this.requestRefresh(true));
    backgroundRuntimeState.subscribe(() => this.requestRefresh(true));
    AppState.addEventListener('change', (state) => {
      // 系统弹窗产生的 inactive 不结束前台会话。
      if (state !== 'background' && state !== 'active') return;
      const active = state === 'active';
      if (foreground === active) return;
      foreground = active;
      this.requestRefresh(false, active);
    });
  }

  private requestRefresh(configChanged = false, foreground?: boolean): void {
    this.refresh(configChanged, foreground).catch((error) => {
      console.error('[LongRunningTaskManager] Failed to reconcile tasks:', error);
    });
  }
}

export const longRunningTaskManager = new LongRunningTaskManager();

// 两端共享注册顺序。原生服务可在后台运行时，沿用原有 keepAlive 策略。
longRunningTaskManager.register(networkAutoSwitchTask, supportsBackgroundTasks);
// 前台监听暂停时保留已启动的传输服务、进度订阅和共享附件队列。
longRunningTaskManager.register(
  new ClipboardSyncTask(supportsBackgroundTasks),
  supportsBackgroundTasks ? false : 'whileRunning'
);
longRunningTaskManager.register(smsForwardingTask, supportsBackgroundTasks);
longRunningTaskManager.register(historyTrackerTask, supportsBackgroundTasks);
longRunningTaskManager.register(clipboardMonitorTask, supportsBackgroundTasks);
longRunningTaskManager.register(remoteClipboardMonitorTask, supportsBackgroundTasks);
longRunningTaskManager.register(historySyncTask, supportsBackgroundTasks || 'whileRunning');
longRunningTaskManager.register(foregroundServiceTask);
longRunningTaskManager.register(shizukuRecoveryTask);
