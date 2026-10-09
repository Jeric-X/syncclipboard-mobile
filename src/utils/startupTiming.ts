import { getStartupElapsedMs } from './startupClock';

type TimingDetails = Record<string, string | number | boolean | null>;

const recordedStages = new Set<string>();
const jsRun = Date.now().toString(36);

function writeTiming(stage: string, details: TimingDetails): void {
  console.info(
    `[StartupTiming] ${JSON.stringify({
      jsRun,
      stage,
      jsUptimeMs: Math.round(getStartupElapsedMs()),
      wallTimeMs: Date.now(),
      ...details,
    })}`
  );
}

/** 每个 JS 运行时只记录一次指定节点，避免轮询和前后台切换刷屏。 */
export function logStartupPoint(stage: string, details: TimingDetails = {}): void {
  if (recordedStages.has(stage)) return;
  recordedStages.add(stage);
  writeTiming(stage, details);
}

/** 只测量指定阶段的首次调用，保留原操作的返回值和异常。 */
export async function measureStartup<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  if (recordedStages.has(stage)) return operation();
  recordedStages.add(stage);
  const startedAt = performance.now();
  writeTiming(stage, { event: 'begin' });
  let succeeded = false;
  try {
    const result = await operation();
    succeeded = true;
    return result;
  } finally {
    writeTiming(stage, {
      event: 'end',
      durationMs: Math.round(performance.now() - startedAt),
      succeeded,
    });
  }
}
