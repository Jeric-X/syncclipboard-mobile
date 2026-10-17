import { setTimer, clearTimer } from 'native-timer';
import { configService } from '../ConfigService';
import { useStatisticsStore } from '../../stores/statisticsStore';

// 旧会话清理与新会话启动共用队列，避免旧任务 finally 停掉新会话的记录。
let queue = Promise.resolve();
let stopCurrent: (() => Promise<void>) | undefined;
const onError = (error: unknown): void => {
  console.error('[HeadlessLifetimeTracking] Failed to record lifetime:', error);
};
const enqueue = (operation: () => Promise<void>): Promise<void> => {
  queue = queue.then(operation).catch(onError);
  return queue;
};

/** 跟随 Headless 服务任务统计，返回幂等清理函数；不阻塞服务初始化。 */
export function startHeadlessLifetimeTracking(): () => Promise<void> {
  void stopCurrent?.();
  const sessionStartedAt = new Date().toISOString();
  const store = useStatisticsStore.getState();
  let startedAt = sessionStartedAt;
  let enabled = false;
  let stopped = false;
  let timer: string | null = null;
  let heartbeatPending = false;
  let stopPromise: Promise<void> | undefined;
  const clearHeartbeat = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const recordHeartbeat = async (at: string): Promise<void> => {
    // 启动幂等；存储失败后由下一次心跳重试。
    await store.recordSessionStart(startedAt, at);
    await store.updateHeartbeat(at);
  };
  const heartbeat = (): void => {
    if (stopped || heartbeatPending) return;
    heartbeatPending = true;
    const at = new Date().toISOString();
    void enqueue(async () => {
      try {
        if (enabled) await recordHeartbeat(at);
      } finally {
        heartbeatPending = false;
      }
    });
  };
  const configure = async (debugMode: boolean, at: string): Promise<void> => {
    if (enabled === debugMode) return;
    enabled = debugMode;
    clearHeartbeat();
    if (enabled) {
      startedAt = at;
      if (!stopped) timer = setTimer(heartbeat, 5_000);
      await recordHeartbeat(at);
    } else {
      try {
        await recordHeartbeat(at);
      } finally {
        await store.stopRecording();
      }
    }
  };
  const initialConfig = configService.getConfig().catch(onError);
  // 初始读取、配置通知、结束事件顺序执行，短会话也能完整记录起止点。
  void enqueue(async () => {
    const config = await initialConfig;
    if (config) await configure(!!config.debugMode, sessionStartedAt);
  });
  const unsubscribe = configService.subscribe((config) => {
    const at = new Date().toISOString();
    void enqueue(() => configure(!!config.debugMode, at));
  });
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopped = true;
    unsubscribe();
    clearHeartbeat();
    const endedAt = new Date().toISOString();
    stopPromise = enqueue(() => configure(false, endedAt));
    if (stopCurrent === stop) stopCurrent = undefined;
    return stopPromise;
  };
  stopCurrent = stop;
  return stop;
}
