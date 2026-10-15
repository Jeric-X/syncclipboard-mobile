import { AppState, Platform } from 'react-native';
import * as overlayModule from 'clipboard-overlay';
import { setTimer, clearTimer } from 'native-timer';
import { configService } from './ConfigService';
import { OverlayLifecycle } from '../utils/overlayLifecycle';

const IDLE_TIMER_TAG = 'clipboard_overlay_idle';
const lifecycle = new OverlayLifecycle({
  hasPermission: overlayModule.hasOverlayPermission,
  isShowing: overlayModule.isOverlayShowing,
  show: overlayModule.showOverlayWindow,
  hide: overlayModule.hideOverlayWindow,
  setDebugMode: overlayModule.setDebugMode,
  setMaxRetries: overlayModule.setMaxRetries,
  scheduleIdle: (callback) => {
    clearTimer(IDLE_TIMER_TAG);
    setTimer(callback, 10_000, IDLE_TIMER_TAG);
  },
  cancelIdle: () => clearTimer(IDLE_TIMER_TAG),
  onError: (error) => console.warn('[OverlayRuntime] Failed to update overlay:', error),
});

let configRevision = 0;
let initialized: Promise<void> | null = null;

if (Platform.OS === 'android') {
  void lifecycle.setForeground(AppState.currentState === 'active');
  configService.subscribe((config) => {
    configRevision += 1;
    void lifecycle.updateConfig(config);
  });
  AppState.addEventListener('change', (state) => {
    void lifecycle.setForeground(state === 'active');
  });
}

async function initialize(): Promise<void> {
  if (!initialized) {
    const revision = configRevision;
    initialized = configService
      .getConfig()
      .then(async (config) => {
        // 不让较早的异步读取覆盖配置订阅已收到的新值。
        if (revision === configRevision) await lifecycle.updateConfig(config);
      })
      .catch((error) => {
        initialized = null;
        throw error;
      });
  }
  await initialized;
}

/** 随 Headless 会话持有保活需求；失败不阻止同步服务启动。 */
export function acquireKeepAliveOverlay(): () => Promise<void> {
  if (Platform.OS !== 'android') return async () => {};
  const release = lifecycle.acquireKeepAlive();
  void initialize().catch((error) => {
    console.warn('[OverlayRuntime] Failed to load overlay settings:', error);
  });
  return release;
}

/** 获取一次剪贴板读取的使用权，调用方必须在 finally 中释放。 */
export async function acquireClipboardOverlay(): Promise<(() => Promise<void>) | null> {
  if (Platform.OS !== 'android') return null;
  try {
    await initialize();
    return await lifecycle.acquireClipboard();
  } catch (error) {
    console.warn('[OverlayRuntime] Failed to acquire clipboard overlay:', error);
    return null;
  }
}

/** 启动重试临时使用窗口，不改变剪贴板或保持后台运行的用户设置。 */
export async function acquireStartupOverlay(): Promise<(() => Promise<void>) | null> {
  if (Platform.OS !== 'android') return null;
  await initialize();
  return lifecycle.acquireStartup();
}

/** Runtime 空闲时释放剪贴板占用，保活占用由 Headless 会话独立释放。 */
export async function dismissClipboardOverlay(): Promise<void> {
  if (Platform.OS === 'android') await lifecycle.dismissClipboard();
}
