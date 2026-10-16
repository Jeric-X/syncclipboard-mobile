import { headlessRuntimeInitialization } from './headlessRuntimeInitialization';
import { acquireKeepAliveOverlay } from '../overlay/OverlayManager';
import { Platform } from 'react-native';
import * as ForegroundService from 'foreground-service';
import {
  startServiceRuntime,
  stopServiceRuntime,
  stopServiceRuntimeIfIdle,
} from '../ServiceRuntime';
import { runHeadlessServiceRuntimeSession } from './headlessServiceRuntimeSession';

/** 无 Activity 的服务运行时入口；Promise 直到进程级会话结束才结束。 */
export default async function ServiceRuntimeHeadlessTask(data: {
  sessionId: string;
}): Promise<void> {
  if (Platform.OS !== 'android') return;
  console.info('[ServiceRuntimeHeadlessTask] Starting session', data.sessionId);
  try {
    await runHeadlessServiceRuntimeSession(data.sessionId, {
      subscribeStopped: (listener) => {
        const subscription = ForegroundService.addSessionStoppedListener(({ sessionId }) =>
          listener(sessionId)
        );
        return () => subscription?.remove();
      },
      subscribeControl: (listener) => {
        const forwardPendingControl = (): void => {
          const reason = ForegroundService.getStopReason();
          // 用户已恢复时忽略事件队列里迟到的旧命令。
          if (reason) listener(reason);
        };
        const stop = ForegroundService.addStopListener(forwardPendingControl);
        const temporary = ForegroundService.addTempStopListener(forwardPendingControl);
        return () => {
          stop?.remove();
          temporary?.remove();
        };
      },
      getPendingControl: ForegroundService.getStopReason,
      stopFromControl: (reason) => {
        headlessRuntimeInitialization.end(data.sessionId);
        return stopServiceRuntime(data.sessionId, reason);
      },
      isActive: (sessionId) => ForegroundService.getSessionId() === sessionId,
      initialize: () =>
        headlessRuntimeInitialization.initialize(data.sessionId, startServiceRuntime),
      acquireKeepAliveOverlay,
      markReady: ForegroundService.markSessionReady,
      finishSession: ForegroundService.finishHeadlessRuntime,
      shutdownIfIdle: stopServiceRuntimeIfIdle,
    });
  } finally {
    headlessRuntimeInitialization.end(data.sessionId);
  }
  console.info('[ServiceRuntimeHeadlessTask] Session stopped', data.sessionId);
}
