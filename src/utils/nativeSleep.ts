import { clearTimer, setTimer } from 'native-timer';

/** Android 后台等待使用原生计时器；取消时同时清理计时器并唤醒等待方。 */
export function nativeSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let tag: string | undefined;
    const finish = () => {
      if (tag) clearTimer(tag);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    signal.addEventListener('abort', finish);
    try {
      tag = setTimer(finish, milliseconds);
    } catch (error) {
      signal.removeEventListener('abort', finish);
      reject(error);
    }
  });
}
