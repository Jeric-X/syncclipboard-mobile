import i18n from '@/i18n';
import { AppState, type AppStateStatus } from 'react-native';
import type { AppConfig } from '@/types/storage';
import { clipboardMonitor } from '../clipboard/ClipboardMonitor';
import { useLocalClipboardStore } from '@/stores/localClipboardStore';
import { profileDtoToContent } from '@/utils/clipboard/convert';
import { clipboardSyncState } from './SyncState';
import { configService } from '../ConfigService';
import { createClientFromConfig } from '../ClientFactory';
import {
  syncResumeText,
  clearResumeTextBaseline,
  resumeTargetIdentity,
  type IosTextAction,
} from './iosResumeTextSync';

type ActionResult = 'success' | 'unavailable' | 'failed' | 'canceled';
type ManualAction = Exclude<IosTextAction, 'resume'>;
type RunAction = (
  action: IosTextAction,
  serverId?: string,
  expectedText?: string
) => Promise<ActionResult>;
let runAction: RunAction | undefined;

/** 首页的显式操作和自动检查使用同一队列，固定点击时的服务器。 */
export function runIosTextAction(
  action: ManualAction,
  serverId: string,
  expectedText?: string
): Promise<ActionResult> {
  return runAction?.(action, serverId, expectedText) ?? Promise.resolve('canceled');
}

function getServer(config: AppConfig) {
  return config.servers[config.activeServerIndex];
}

/** 只消费真正的后台恢复事件。离开当前目标时取消正在执行和排队的工作。 */
export function installIosResumeTextSync(): () => void {
  let backgroundSeen = false;
  let session = new AbortController();
  let automatic = new AbortController();
  let pendingUpload: AbortSignal | undefined;
  let config: AppConfig | undefined;
  let queue = Promise.resolve();

  let needsBaselineReset = false;
  async function resetBaselineIfNeeded(): Promise<void> {
    if (!needsBaselineReset) return;
    await clearResumeTextBaseline();
    needsBaselineReset = false;
  }

  function cancelAutomatic() {
    automatic.abort();
    automatic = new AbortController();
  }

  function invalidate() {
    cancelAutomatic();
    session.abort();
    session = new AbortController();
  }

  const unsubscribe = configService.subscribe((next) => {
    const targetChanged =
      config && resumeTargetIdentity(getServer(config)) !== resumeTargetIdentity(getServer(next));
    if (targetChanged) invalidate();
    else if (config?.autoSync !== next.autoSync) cancelAutomatic();
    if (targetChanged) {
      needsBaselineReset = true;
      queue = queue.then(resetBaselineIfNeeded).catch(() => {
        // 下一次读取前重试清理；清理失败时不能使用旧目标的基准。
      });
      clipboardSyncState.setState({ remoteContent: null, syncError: null });
    }
    config = next;
  });
  // 冷启动只读取配置。配置通知先到时保留较新的值。
  const ready = configService.getConfig().then((initial) => {
    config ??= initial;
  });

  const run: RunAction = (action, serverId, expectedText) => {
    const { signal } = action === 'resume' ? automatic : session;
    const upload = action === 'upload' || action === 'paste';
    if (upload && pendingUpload === signal) return Promise.resolve('canceled');
    if (upload) {
      pendingUpload = signal;
      clipboardSyncState.setUploadingClipboard(true);
    }
    const result = queue
      .then(async (): Promise<ActionResult> => {
        await ready;
        await resetBaselineIfNeeded();
        if (signal.aborted || backgroundSeen || !config) return 'canceled';
        const server = getServer(config);
        if (!server?.id || server.type === 's3' || (serverId && serverId !== server.id))
          return 'canceled';
        if (action === 'resume' && !config.autoSync) return 'canceled';
        const observed = await syncResumeText(
          server,
          createClientFromConfig(server),
          signal,
          action,
          expectedText
        );
        if (!observed || signal.aborted) return 'canceled';
        if (observed.local) {
          const local = profileDtoToContent(observed.local);
          void clipboardMonitor.setLastContent(local);
          useLocalClipboardStore.getState().setCurrentContentDisplay(local);
        } else if (observed.local === null) {
          clipboardMonitor.reset();
          useLocalClipboardStore.setState({ currentContent: null });
        }
        clipboardSyncState.setState({
          remoteContent: observed.remote ? profileDtoToContent(observed.remote) : null,
          syncError: observed.failed ? { title: i18n.t('settings.iosResumeSyncFailed') } : null,
        });
        if (observed.completed) return 'success';
        if (!observed.failed && action === 'upload' && observed.local === null)
          return 'unavailable';
        return 'failed';
      })
      .catch((error): ActionResult => {
        if (!signal.aborted) {
          clipboardSyncState.setSyncError({ title: i18n.t('settings.iosResumeSyncFailed') });
          console.warn(
            '[iOS] Clipboard action failed:',
            error instanceof Error ? error.message : 'unknown error'
          );
        }
        return signal.aborted ? 'canceled' : 'failed';
      });
    queue = result.then(() => {
      if (upload && pendingUpload === signal) {
        pendingUpload = undefined;
        clipboardSyncState.setUploadingClipboard(false);
      }
    });
    return result;
  };
  runAction = run;
  function onState(state: AppStateStatus): void {
    if (state === 'background') {
      backgroundSeen = true;
      invalidate();
    } else if (state === 'active' && backgroundSeen) {
      backgroundSeen = false;
      void run('resume');
    }
  }
  const subscription = AppState.addEventListener('change', onState);
  return () => {
    invalidate();
    runAction = undefined;
    unsubscribe();
    subscription.remove();
  };
}
