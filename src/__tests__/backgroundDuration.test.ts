import { calculateBackgroundDurationMs } from '../utils/backgroundDuration';

describe('calculateBackgroundDurationMs', () => {
  it('uses elapsed realtime for a 30 minute background session', () => {
    expect(
      calculateBackgroundDurationMs({
        accumulatedDurationMs: 0,
        backgroundStartElapsedRealtimeMs: 10_000,
        currentElapsedRealtimeMs: 1_810_000,
        backgroundStartWallClockMs: 1_000_000,
        currentWallClockMs: 9_000_000,
      })
    ).toBe(30 * 60 * 1000);
  });

  it('adds the elapsed interval to an existing accumulated duration', () => {
    expect(
      calculateBackgroundDurationMs({
        accumulatedDurationMs: 5_000,
        backgroundStartElapsedRealtimeMs: 20_000,
        currentElapsedRealtimeMs: 27_500,
        backgroundStartWallClockMs: 1_000_000,
        currentWallClockMs: 1_007_500,
      })
    ).toBe(12_500);
  });

  it('ignores wall clock changes while elapsed realtime remains valid', () => {
    expect(
      calculateBackgroundDurationMs({
        accumulatedDurationMs: 0,
        backgroundStartElapsedRealtimeMs: 100_000,
        currentElapsedRealtimeMs: 160_000,
        backgroundStartWallClockMs: 2_000_000,
        currentWallClockMs: 1_000_000,
      })
    ).toBe(60_000);
  });

  it('falls back to non-negative wall time after a device reboot', () => {
    expect(
      calculateBackgroundDurationMs({
        accumulatedDurationMs: 0,
        backgroundStartElapsedRealtimeMs: 5_000_000,
        currentElapsedRealtimeMs: 10_000,
        backgroundStartWallClockMs: 2_000_000,
        currentWallClockMs: 2_120_000,
      })
    ).toBe(120_000);

    expect(
      calculateBackgroundDurationMs({
        accumulatedDurationMs: 0,
        backgroundStartElapsedRealtimeMs: 5_000_000,
        currentElapsedRealtimeMs: 10_000,
        backgroundStartWallClockMs: 2_000_000,
        currentWallClockMs: 1_000_000,
      })
    ).toBe(0);
  });
});
