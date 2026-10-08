import { Platform } from 'react-native';
import * as ForegroundService from 'foreground-service';
import { startServiceRuntime, stopServiceRuntimeIfIdle } from '../services/ServiceRuntime';
import { runHeadlessServiceRuntimeSession } from '../utils/headlessServiceRuntimeSession';

/** 无 Activity 的服务运行时入口；Promise 直到原生服务停止才结束。 */
export default async function ServiceRuntimeHeadlessTask(data: {
  sessionId: string;
}): Promise<void> {
  if (Platform.OS !== 'android') return;
  console.info('[ServiceRuntimeHeadlessTask] Starting session', data.sessionId);
  await runHeadlessServiceRuntimeSession(data.sessionId, {
    subscribeStopped: (listener) => {
      const subscription = ForegroundService.addSessionStoppedListener(({ sessionId }) =>
        listener(sessionId)
      );
      return () => subscription?.remove();
    },
    isActive: (sessionId) => ForegroundService.getSessionId() === sessionId,
    initialize: startServiceRuntime,
    markReady: ForegroundService.markSessionReady,
    shutdownIfIdle: stopServiceRuntimeIfIdle,
  });
  console.info('[ServiceRuntimeHeadlessTask] Session stopped', data.sessionId);
}
