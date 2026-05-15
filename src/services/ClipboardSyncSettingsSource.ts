import type { ServerConfig } from '../types/api';
import type { AppConfig } from '../types/storage';
import { useSettingsStore } from '../stores/settingsStore';

function extractConfigFromSettingsState(state: unknown): AppConfig | null {
  return state && typeof state === 'object' && 'config' in state
    ? ((state as { config: AppConfig | null }).config ?? null)
    : null;
}

export interface ClipboardSyncSettingsSource {
  ensureLoaded(): Promise<void>;
  getActiveServer(): ServerConfig | null;
  getConfig(): AppConfig | null;
  subscribeConfig(
    listener: (config: AppConfig | null, prevConfig: AppConfig | null) => void
  ): () => void;
}

export function createSettingsStoreClipboardSyncSettingsSource(): ClipboardSyncSettingsSource {
  return {
    ensureLoaded: async () => {
      if (!useSettingsStore.getState().isLoaded) {
        await useSettingsStore.getState().loadConfig();
      }
    },
    getActiveServer: () => useSettingsStore.getState().getActiveServer(),
    getConfig: () => useSettingsStore.getState().config ?? null,
    subscribeConfig: (listener) =>
      useSettingsStore.subscribe((state: unknown, prevState: unknown) => {
        const config = extractConfigFromSettingsState(state);
        const prevConfig = extractConfigFromSettingsState(prevState);
        listener(config, prevConfig);
      }),
  };
}
