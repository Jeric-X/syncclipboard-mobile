import { Platform } from 'react-native';
import { AppConfig } from '@/types/storage';

export function isHistorySyncEnabled(cfg: AppConfig | null | undefined): boolean {
  if (!cfg?.enableHistorySync) {
    return false;
  }
  if (!cfg?.servers?.length || cfg.activeServerIndex < 0) {
    return false;
  }
  const serverConfig = cfg.servers[cfg.activeServerIndex];
  return serverConfig?.type === 'syncclipboard';
}

/** 后台任务开关仅在 Android 上生效，即使配置来自其他设备。 */
export function areBackgroundTasksEnabled(cfg: AppConfig): boolean {
  return Platform.OS === 'android' && cfg.enableBackgroundTasks;
}
