import type { AppConfig } from '../types/storage';

type ColdStartConfig = Pick<AppConfig, 'debugMode' | 'debugColdStartToast' | 'language'>;

interface ColdStartNotifierDeps {
  platform: string;
  loadConfig: () => Promise<ColdStartConfig>;
  showToast: (config: ColdStartConfig) => void;
}

/** 每个运行时只检查一次冷启动开关；重复调用共享结果，开启开关不补发旧启动提示。 */
export function createColdStartNotifier(deps: ColdStartNotifierDeps): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => {
    if (!pending) {
      pending = (async () => {
        if (deps.platform !== 'android') return;
        const config = await deps.loadConfig();
        if (config.debugMode && config.debugColdStartToast) deps.showToast(config);
      })();
    }
    return pending;
  };
}
