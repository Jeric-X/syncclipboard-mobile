jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStatisticsStore } from '../stores/statisticsStore';
const mockSetItem = AsyncStorage.setItem as jest.Mock;

describe('statisticsStore background duration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    useStatisticsStore.setState({
      data: { backgroundTaskRecords: [] },
      isLoaded: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists a monotonic start and completes it without periodic writes', async () => {
    await useStatisticsStore.getState().recordBackgroundTaskStart(10_000);

    const pendingRecord = useStatisticsStore.getState().data.backgroundTaskRecords[0];
    expect(pendingRecord).toMatchObject({
      startedAt: '2026-09-01T00:00:00.000Z',
      lastHeartbeat: '2026-09-01T00:00:00.000Z',
      durationMs: 0,
      backgroundStartElapsedRealtimeMs: 10_000,
    });
    expect(mockSetItem).toHaveBeenCalledTimes(1);

    // Deliberately move wall time by much more than the monotonic 30-minute interval.
    jest.setSystemTime(new Date('2026-09-01T04:00:00.000Z'));
    const durationMs = await useStatisticsStore.getState().completeBackgroundTask(1_810_000);

    expect(durationMs).toBe(30 * 60 * 1000);
    expect(useStatisticsStore.getState().data.backgroundTaskRecords[0]).toEqual({
      startedAt: '2026-09-01T00:00:00.000Z',
      lastHeartbeat: '2026-09-01T00:30:00.000Z',
      durationMs: 30 * 60 * 1000,
    });
    expect(mockSetItem).toHaveBeenCalledTimes(2);
    expect(useStatisticsStore.getState().getStatisticsText()).toContain('持续: 30分钟');
  });

  it('leaves legacy heartbeat records readable', () => {
    useStatisticsStore.setState({
      data: {
        backgroundTaskRecords: [
          {
            startedAt: '2026-09-01T00:00:00.000Z',
            lastHeartbeat: '2026-09-01T00:02:00.000Z',
          },
        ],
      },
      isLoaded: true,
    });

    expect(useStatisticsStore.getState().getStatisticsText()).toContain('持续: 2分钟');
  });
});
