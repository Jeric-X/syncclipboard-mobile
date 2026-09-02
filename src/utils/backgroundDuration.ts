export interface BackgroundDurationInput {
  accumulatedDurationMs: number;
  backgroundStartElapsedRealtimeMs: number;
  currentElapsedRealtimeMs: number;
  backgroundStartWallClockMs: number;
  currentWallClockMs: number;
}

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Calculates a completed background duration from Android's monotonic clock.
 * Wall time is only used when elapsed realtime moved backwards across a reboot.
 */
export function calculateBackgroundDurationMs(input: BackgroundDurationInput): number {
  const accumulatedDurationMs = nonNegativeFinite(input.accumulatedDurationMs);
  const hasValidElapsedRealtime =
    Number.isFinite(input.backgroundStartElapsedRealtimeMs) &&
    Number.isFinite(input.currentElapsedRealtimeMs) &&
    input.currentElapsedRealtimeMs >= input.backgroundStartElapsedRealtimeMs;

  const intervalDurationMs = hasValidElapsedRealtime
    ? input.currentElapsedRealtimeMs - input.backgroundStartElapsedRealtimeMs
    : nonNegativeFinite(input.currentWallClockMs - input.backgroundStartWallClockMs);

  return accumulatedDurationMs + intervalDurationMs;
}
