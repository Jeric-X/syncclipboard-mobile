import { LongRunningTask } from './LongRunningTask';
import { networkAutoSwitchService } from '@/services/NetworkAutoSwitchService';

class NetworkAutoSwitchTask extends LongRunningTask {
  readonly name = 'networkAutoSwitch';

  start(): Promise<void> {
    return networkAutoSwitchService.start();
  }

  stop(): Promise<void> {
    return networkAutoSwitchService.stop();
  }

  isRunning(): boolean {
    return networkAutoSwitchService.isRunning();
  }

  override onConfigChanged(): Promise<void> {
    return networkAutoSwitchService.onConfigChanged();
  }

  override onForeground(): Promise<void> {
    return networkAutoSwitchService.onForeground();
  }
}

export const networkAutoSwitchTask = new NetworkAutoSwitchTask();
