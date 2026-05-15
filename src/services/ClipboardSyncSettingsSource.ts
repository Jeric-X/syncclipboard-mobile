import type { ServerConfig } from '../types/api';
import type { AppConfig } from '../types/storage';

export interface ClipboardSyncSettingsSource {
  ensureLoaded(): Promise<void>;
  getActiveServer(): ServerConfig | null;
  getConfig(): AppConfig | null;
  subscribeConfig(
    listener: (config: AppConfig | null, prevConfig: AppConfig | null) => void
  ): () => void;
}

export function createSettingsStoreClipboardSyncSettingsSource(): ClipboardSyncSettingsSource {
  const { useSettingsStore } = require('../stores/settingsStore');

  return {
    ensureLoaded: async () => {
      if (!useSettingsStore.getState().isLoaded) {
        await useSettingsStore.getState().loadConfig();
      }
    },
    getActiveServer: () => useSettingsStore.getState().getActiveServer(),
    getConfig: () => useSettingsStore.getState().config ?? null,
    subscribeConfig: (listener) =>
      useSettingsStore.subscribe(
        (state: { config: AppConfig | null }, prevState: { config: AppConfig | null }) => {
          listener(state.config ?? null, prevState.config ?? null);
        }
      ),
  };
}
