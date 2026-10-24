import type { AppConfig } from './storage';

/** 配置 API 的模块边界；存储格式和现有内存缓存保持不变。 */
export const CONFIG_MODULE_FIELDS = {
  appearance: ['theme', 'language', 'hideFromRecents'],
  sync: [
    'syncInterval',
    'conflictResolution',
    'syncLargeFiles',
    'largeFileThreshold',
    'syncInBackground',
    'syncOnStartup',
    'autoSync',
    'autoDownloadMaxSize',
    'remotePollingInterval',
    'localPollingInterval',
    'syncToastEnabled',
  ],
  background: [
    'enableBackgroundTasks',
    'enableBackgroundDownload',
    'enableBackgroundUpload',
    'enableOverlayKeepAlive',
    'enableTileRecovery',
    'enableShizukuRecovery',
    'enableForegroundNotification',
    'enableForegroundServiceSticky',
  ],
  clipboard: ['enableClipboardOverlay', 'enableShizukuClipboard', 'enableSmsForwarding'],
  history: [
    'maxHistoryItems',
    'enableHistorySync',
    'needsHistoryReorganize',
    'historyImageAutoDownload',
    'showImageCopyButton',
  ],
  updates: ['autoCheckUpdate', 'lastUpdateCheckDate', 'updateToBeta', 'updateChannel'],
  debug: [
    'debugMode',
    'logLevel',
    'debugOverlayVisible',
    'debugUrlScheme',
    'debugColdStartToast',
    'debugUpdateCheckNoLimit',
  ],
  notifications: ['enableNotifications'],
  storage: ['autoSaveSyncFile', 'syncFileSavePath'],
} as const satisfies Record<string, readonly (keyof AppConfig)[]>;

export type ConfigModule = keyof typeof CONFIG_MODULE_FIELDS;
export type ConfigModuleUpdates<K extends ConfigModule> = Partial<
  Pick<AppConfig, (typeof CONFIG_MODULE_FIELDS)[K][number]>
>;

/** 运行时也限制更新范围，防止结构类型允许的多余字段被写入。 */
export function pickModuleUpdates<K extends ConfigModule>(
  module: K,
  updates: ConfigModuleUpdates<K>
): Partial<AppConfig> {
  return Object.fromEntries(
    CONFIG_MODULE_FIELDS[module]
      .filter((key) => Object.prototype.hasOwnProperty.call(updates, key))
      .map((key) => [key, (updates as Partial<AppConfig>)[key]])
  );
}
