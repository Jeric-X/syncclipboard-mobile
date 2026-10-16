import { Platform } from 'react-native';
import { setRecoveryEnabled } from 'shizuku-clipboard';
import { getStopReason } from 'foreground-service';
import { LongRunningTask } from './LongRunningTask';
import { configService } from '../services/ConfigService';
import { backgroundRuntimeState } from '../services/BackgroundRuntimeState';
import type { AppConfig } from '../types/storage';

/** 守护只恢复用户允许的后台同步；原生注册与剪贴板读取方式无关。 */
export class ShizukuRecoveryTask extends LongRunningTask {
  readonly name = 'shizukuRecovery';
  private running = false;
  private config: AppConfig | null = null;
  private revision = 0;
  private unsubscribeConfig: (() => void) | null = null;
  private unsubscribeState: (() => void) | null = null;

  async start(): Promise<void> {
    if (Platform.OS !== 'android' || this.running) return;
    this.running = true;
    const revision = ++this.revision;
    this.unsubscribeConfig = configService.subscribe((config) => {
      this.revision++;
      this.config = config;
      this.apply();
    });
    this.unsubscribeState = backgroundRuntimeState.subscribe(() => this.apply());
    try {
      const config = await configService.getConfig();
      if (this.running && revision === this.revision) {
        this.config = config;
        this.apply();
      }
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.revision++;
    this.config = null;
    this.unsubscribeConfig?.();
    this.unsubscribeState?.();
    this.unsubscribeConfig = null;
    this.unsubscribeState = null;
    setRecoveryEnabled(false);
  }

  isRunning(): boolean {
    return this.running;
  }

  private apply(): void {
    const config = this.config;
    setRecoveryEnabled(
      this.running &&
        config?.enableShizukuRecovery === true &&
        config.enableBackgroundTasks &&
        (config.enableBackgroundUpload || config.enableBackgroundDownload) &&
        !backgroundRuntimeState.isTempDisabled() &&
        !getStopReason()
    );
  }
}

export const shizukuRecoveryTask = new ShizukuRecoveryTask();
