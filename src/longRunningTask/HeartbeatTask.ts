/**
 * HeartbeatTask（Android 专属）
 * 持续任务：后台统计心跳。
 *
 * 职责：
 * - 进入后台时记录后台任务启动事件，并开始每 60 秒的心跳计数
 * - 返回前台时停止心跳
 *
 * 注册为 keepAlive = false，后台且总开关关闭时由 LongRunningTaskManager 调用 stop() 停止心跳。
 * 非 Android 平台上为空操作。
 * 生命周期由 LongRunningTaskManager 统一管理。
 */

import { Platform } from 'react-native';
import { setTimer, clearTimer } from 'native-timer';
import { LongRunningTask } from './LongRunningTask';

class HeartbeatTask extends LongRunningTask {
  readonly name = 'heartbeat';

  private heartbeatTag: string | null = null;

  async start(): Promise<void> {
    // 心跳只在后台运行，start() 为空操作，等待 onBackground()
  }

  async stop(): Promise<void> {
    if (!this.heartbeatTag) return;
    try {
      clearTimer(this.heartbeatTag);
    } catch {}
    this.heartbeatTag = null;
  }

  isRunning(): boolean {
    return this.heartbeatTag !== null;
  }

  override async onBackground(): Promise<void> {
    if (Platform.OS !== 'android') return;
    await this.stop(); // 确保不重复启动
    try {
      const { useStatisticsStore } = require('../stores/statisticsStore');
      await useStatisticsStore.getState().recordBackgroundTaskStart();
      this.heartbeatTag = setTimer(() => {
        useStatisticsStore.getState().updateHeartbeat();
      }, 60_000);
    } catch (e) {
      console.error('[HeartbeatTask] Failed to start heartbeat:', e);
    }
  }

  override async onForeground(): Promise<void> {
    await this.stop();
  }
}

export const heartbeatTask = new HeartbeatTask();
