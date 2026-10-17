/** 从应用入口安装，覆盖主界面、快捷操作以及无界面的 Headless 启动。 */
import { AppState } from 'react-native';
import { setTimer, clearTimer } from 'native-timer';
import { useStatisticsStore } from '../stores/statisticsStore';
import { configService } from './ConfigService';
import { appStartedAt } from '../utils/startupClock';
import { createAppLifetimeTracking } from '../utils/appLifetimeTracking';

export const installAppLifetimeTracking = createAppLifetimeTracking({
  startedAt: appStartedAt,
  now: () => new Date().toISOString(),
  loadDebugMode: async () => !!(await configService.getConfig()).debugMode,
  subscribeDebugMode: (callback) =>
    configService.subscribe((config) => callback(!!config.debugMode)),
  recordAppStart: (startedAt) => useStatisticsStore.getState().recordAppStart(startedAt),
  updateHeartbeat: () => useStatisticsStore.getState().updateHeartbeat(),
  stopRecording: () => useStatisticsStore.getState().stopRecording(),
  setTimer,
  clearTimer,
  subscribeAppState: (callback) => AppState.addEventListener('change', callback),
  onError: (error) => console.error('[AppLifetimeTracking] Failed to record heartbeat:', error),
});
