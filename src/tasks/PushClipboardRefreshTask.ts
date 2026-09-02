/**
 * FCM cold-start headless task.
 * The push payload is only a change hint; clipboard state is always fetched through HTTP.
 */

import { Platform } from 'react-native';
import { configService } from '../services/ConfigService';
import { getClipboardChangedHandler } from '../services/sync/ClipboardChangedHandler';
import { remoteClipboardMonitor } from '../services/sync/RemoteClipboardMonitor';
import type { AppConfig } from '../types/storage';
import type { ClipboardContent } from '../types/clipboard';
import type { ServerConfig } from '../types/api';
import { initLogger } from '../utils/Logger';

export interface PushClipboardRefreshTaskData {
  hash?: string;
}

export interface PushClipboardRefreshDependencies {
  loadConfig(): Promise<AppConfig | null>;
  getActiveServer(): Promise<ServerConfig | null>;
  fetchLatest(): Promise<ClipboardContent>;
  processRemote(content: ClipboardContent): Promise<void>;
  initializeLogging(): void;
}

const dependencies: PushClipboardRefreshDependencies = {
  loadConfig: () => configService.getConfig(),
  getActiveServer: () => configService.getActiveServer(),
  fetchLatest: () => remoteClipboardMonitor.fetchLatest(),
  processRemote: (content) =>
    getClipboardChangedHandler().processRemoteClipboardContent(content, {
      allowStartupBaseline: false,
    }),
  initializeLogging: initLogger,
};

export async function runPushClipboardRefresh(
  taskData: PushClipboardRefreshTaskData | undefined,
  deps: PushClipboardRefreshDependencies
): Promise<void> {
  if (!taskData?.hash) {
    console.warn('[PushClipboardRefreshTask] Missing hash-only FCM hint; skipping refresh');
    return;
  }
  const [config, server] = await Promise.all([deps.loadConfig(), deps.getActiveServer()]);
  if (!config?.enableBackgroundTasks || !config.enableBackgroundDownload) {
    console.debug('[PushClipboardRefreshTask] Background download disabled; ignoring FCM hint');
    return;
  }
  if (server?.type !== 'syncclipboard') {
    console.debug('[PushClipboardRefreshTask] Active server does not support FCM refresh');
    return;
  }

  const content = await deps.fetchLatest();
  await deps.processRemote(content);
  console.debug('[PushClipboardRefreshTask] Authoritative headless refresh applied');
}

export default async function PushClipboardRefreshTask(
  taskData?: PushClipboardRefreshTaskData
): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    dependencies.initializeLogging();
  } catch (error) {
    console.error('[PushClipboardRefreshTask] Logger initialization failed:', error);
  }
  try {
    await runPushClipboardRefresh(taskData, dependencies);
  } catch (error) {
    console.error('[PushClipboardRefreshTask] Authoritative refresh failed:', error);
  }
}
