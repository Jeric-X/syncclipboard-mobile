/**
 * HeartbeatTask（Android 专属）
 * 生命周期任务：记录每次 Android 后台会话的持续时间。
 *
 * 职责：
 * - 进入后台时持久化墙钟时间和 elapsedRealtime 起点
 * - 返回前台时用 elapsedRealtime 结算时长
 * - 进程被杀后，在下一次前台启动时结算遗留记录
 *
 * 非 Android 平台上为空操作。
 * 生命周期由 LongRunningTaskManager 统一管理。
 */

import { AppState, Platform } from 'react-native';
import { getElapsedRealtimeMs } from 'native-util';
import { LongRunningTask } from './LongRunningTask';
import { useStatisticsStore } from '../stores/statisticsStore';

class HeartbeatTask extends LongRunningTask {
  readonly name = 'heartbeat';

  private running = false;
  private pendingRecoveryChecked = false;
  private lifecycleOperation: Promise<void> = Promise.resolve();

  async start(): Promise<void> {
    if (Platform.OS !== 'android') return;
    this.running = true;
    if (this.pendingRecoveryChecked || AppState.currentState === 'background') return;

    this.pendingRecoveryChecked = true;
    await this.enqueueLifecycleOperation(async () => {
      await this.completePendingSession('Recovered pending background statistics');
    });
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  override async onBackground(): Promise<void> {
    if (Platform.OS !== 'android') return;
    await this.enqueueLifecycleOperation(async () => {
      const elapsedRealtimeMs = getElapsedRealtimeMs();
      if (elapsedRealtimeMs === null) return;
      await useStatisticsStore.getState().recordBackgroundTaskStart(elapsedRealtimeMs);
      console.debug('[HeartbeatTask] Background statistics session started');
    });
  }

  override async onForeground(): Promise<void> {
    if (Platform.OS !== 'android') return;
    await this.enqueueLifecycleOperation(async () => {
      await this.completePendingSession('Background statistics session completed');
    });
  }

  private async completePendingSession(logMessage: string): Promise<void> {
    const elapsedRealtimeMs = getElapsedRealtimeMs();
    if (elapsedRealtimeMs === null) return;
    const durationMs = await useStatisticsStore
      .getState()
      .completeBackgroundTask(elapsedRealtimeMs);
    if (durationMs !== null) {
      console.debug(`[HeartbeatTask] ${logMessage}: durationMs=${durationMs}`);
    }
  }

  private enqueueLifecycleOperation(operation: () => Promise<void>): Promise<void> {
    const nextOperation = this.lifecycleOperation.then(operation, operation);
    this.lifecycleOperation = nextOperation.catch(() => undefined);
    return nextOperation;
  }
}

export const heartbeatTask = new HeartbeatTask();
