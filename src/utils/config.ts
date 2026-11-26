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

/** 后台同步设置仅在支持后台剪贴板任务的平台生效，包括从其他设备导入的配置。 */
export function isBackgroundSyncEnabled(cfg: AppConfig): boolean {
  return Platform.OS === 'android' && cfg.enableBackgroundTasks;
}
