import { useSyncExternalStore } from 'react';
import { networkAutoSwitchService } from '@/services/NetworkAutoSwitchService';

export function useNetworkAutoSwitch() {
  return useSyncExternalStore(
    networkAutoSwitchService.subscribe,
    networkAutoSwitchService.getState,
    networkAutoSwitchService.getState
  );
}
