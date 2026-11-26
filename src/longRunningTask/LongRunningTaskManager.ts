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
import { isBackgroundSyncEnabled } from '../utils/config';
import { AppState, Platform } from 'react-native';
import { LongRunningTaskCoordinator } from './LongRunningTaskCoordinator';

class LongRunningTaskManager extends LongRunningTaskCoordinator {
  constructor() {
    let iosForeground = AppState.currentState === 'active';
    let iosForegroundSession = 0;
    super(
      async () => ({
        backgroundEnabled:
          !backgroundRuntimeState.isTempDisabled() &&
          isBackgroundSyncEnabled(await configService.getConfig()),
        foreground: Platform.OS === 'ios' ? iosForeground : AppState.currentState === 'active',
        foregroundSession: Platform.OS === 'ios' ? iosForegroundSession : undefined,
      }),
      (name, error) => console.error(`[LongRunningTaskManager] Task "${name}" failed:`, error)
    );
    configService.subscribe(() => this.requestRefresh(true));
    backgroundRuntimeState.subscribe(() => this.requestRefresh(true));
    AppState.addEventListener('change', (state) => {
      if (Platform.OS === 'ios') {
        // 系统授权弹窗也会进入 inactive；保留原状态，关闭弹窗不触发第二次读板。
        if (state === 'inactive') return;
        if (iosForeground && state === 'background') iosForegroundSession++;
        iosForeground = state === 'active';
      }
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
  // 传输与进度订阅跨前后台保留。只有两个监听任务随前台状态启停。
  longRunningTaskManager.register(clipboardSyncTask, true);
  longRunningTaskManager.register(clipboardMonitorTask);
  longRunningTaskManager.register(remoteClipboardMonitorTask);
}
