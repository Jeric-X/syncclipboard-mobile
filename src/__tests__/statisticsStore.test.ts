import { createStatisticsStore, MAX_STATISTICS_RECORDS } from '../stores/statisticsStore';

const START = '2026-10-17T01:00:00.000Z';
const LATER = '2026-10-17T01:01:00.000Z';

function setup(raw: string | null = null) {
  let persisted = raw;
  let time = START;
  const storage = {
    getItem: jest.fn(async () => persisted),
    setItem: jest.fn(async (_key: string, value: string) => {
      persisted = value;
    }),
  };
  const store = createStatisticsStore({ storage, now: () => new Date(time) });
  return {
    store,
    storage,
    advance: (value: string) => {
      time = value;
    },
    persisted: () => JSON.parse(persisted!),
  };
}

it('records a runtime once and keeps its start across concurrent loads and heartbeats', async () => {
  const { store, storage, advance, persisted } = setup();
  await Promise.all([
    store.getState().load(),
    store.getState().recordAppStart(START),
    store.getState().recordAppStart(START),
  ]);
  advance(LATER);
  await store.getState().updateHeartbeat();
  expect(storage.getItem).toHaveBeenCalledTimes(1);
  expect(persisted().appLifetimeRecords).toEqual([{ startedAt: START, lastHeartbeat: LATER }]);
  expect(store.getState().getStatisticsText()).toContain('持续: 1分钟');
  expect(store.getState().getStatisticsText()).toContain('启动:');
  expect(store.getState().getStatisticsText()).toContain('最后活跃:');
});

it('preserves previous runtime records without extending them on the next launch', async () => {
  const first = setup();
  await first.store.getState().recordAppStart(START);
  first.advance(LATER);
  await first.store.getState().updateHeartbeat();
  const second = setup(JSON.stringify(first.persisted()));
  second.advance('2026-10-18T01:00:00.000Z');
  await second.store.getState().recordAppStart('2026-10-18T01:00:00.000Z');
  expect(second.persisted().appLifetimeRecords).toEqual([
    { startedAt: '2026-10-18T01:00:00.000Z', lastHeartbeat: '2026-10-18T01:00:00.000Z' },
    { startedAt: START, lastHeartbeat: LATER },
  ]);
});

it('keeps 10000 records instead of five and removes the oldest when starting a new runtime', async () => {
  const records = Array.from({ length: MAX_STATISTICS_RECORDS + 1 }, (_, index) => ({
    startedAt: new Date(Date.parse(START) - index * 60_000).toISOString(),
    lastHeartbeat: START,
  }));
  const { store, advance, persisted } = setup(JSON.stringify({ appLifetimeRecords: records }));
  await store.getState().load();
  expect(store.getState().data.appLifetimeRecords).toHaveLength(MAX_STATISTICS_RECORDS);
  advance(LATER);
  await store.getState().recordAppStart(LATER);
  const saved = persisted().appLifetimeRecords;
  expect(saved).toHaveLength(MAX_STATISTICS_RECORDS);
  expect(saved[0].startedAt).toBe(LATER);
  expect(saved.at(-1)).toEqual(records[MAX_STATISTICS_RECORDS - 2]);
});

it('migrates old background records and labels them separately', async () => {
  const { store, persisted } = setup(
    JSON.stringify({ backgroundTaskRecords: [{ startedAt: START, lastHeartbeat: LATER }] })
  );
  await store.getState().recordAppStart(START);
  expect(persisted().appLifetimeRecords[1].legacyBackground).toBe(true);
  expect(store.getState().getStatisticsText()).toContain('后台记录（旧版）');
  expect(persisted().backgroundTaskRecords).toBeUndefined();
});

it('clears persistently after an in-flight heartbeat, then starts a new segment at clear time', async () => {
  const { store, advance, persisted, storage } = setup();
  await store.getState().recordAppStart(START);
  advance(LATER);
  let finishWrite!: () => void;
  storage.setItem.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      })
  );
  const heartbeat = store.getState().updateHeartbeat();
  await Promise.resolve();
  await Promise.resolve();
  const clearing = store.getState().clear();
  finishWrite();
  await Promise.all([heartbeat, clearing]);
  expect(persisted().appLifetimeRecords).toEqual([]);
  expect(store.getState().data.appLifetimeRecords).toEqual([]);
  advance('2026-10-17T01:02:00.000Z');
  await store.getState().updateHeartbeat();
  expect(persisted().appLifetimeRecords).toEqual([
    { startedAt: LATER, lastHeartbeat: '2026-10-17T01:02:00.000Z' },
  ]);
});

it('does not mutate historical records when viewing or clearing before tracking starts', async () => {
  const records = [{ startedAt: START, lastHeartbeat: LATER }];
  const { store, persisted } = setup(JSON.stringify({ appLifetimeRecords: records }));
  await store.getState().updateHeartbeat();
  expect(store.getState().data.appLifetimeRecords).toEqual(records);
  await store.getState().clear();
  await store.getState().updateHeartbeat();
  expect(persisted().appLifetimeRecords).toEqual([]);
});

it('retries after a storage error without losing old records or duplicating the new start', async () => {
  const { store, storage, persisted } = setup();
  storage.getItem.mockRejectedValueOnce(new Error('read failed'));
  await expect(store.getState().recordAppStart(START)).rejects.toThrow('read failed');
  expect(storage.setItem).not.toHaveBeenCalled();
  storage.setItem.mockRejectedValueOnce(new Error('write failed'));
  await expect(store.getState().recordAppStart(START)).rejects.toThrow('write failed');
  await store.getState().recordAppStart(START);
  expect(persisted().appLifetimeRecords).toHaveLength(1);
});

it('keeps current data when clearing fails', async () => {
  const { store, storage, advance, persisted } = setup();
  await store.getState().recordAppStart(START);
  advance(LATER);
  storage.setItem.mockRejectedValueOnce(new Error('write failed'));
  await expect(store.getState().clear()).rejects.toThrow();
  expect(store.getState().data.appLifetimeRecords).toHaveLength(1);
  await store.getState().updateHeartbeat();
  expect(persisted().appLifetimeRecords[0].startedAt).toBe(START);
});

it.each([
  'invalid json',
  'null',
  '{"appLifetimeRecords":[null,{}, {"startedAt":"bad","lastHeartbeat":"bad"}]}',
])('recovers from malformed persisted data: %s', async (raw) => {
  const { store, persisted } = setup(raw);
  await store.getState().recordAppStart(START);
  expect(persisted().appLifetimeRecords).toEqual([{ startedAt: START, lastHeartbeat: START }]);
});

it('stops extending the current record when debug mode is disabled and starts a separate segment on re-enable', async () => {
  const { store, advance, persisted, storage } = setup();
  await store.getState().recordAppStart(START);
  advance(LATER);
  await store.getState().updateHeartbeat();
  await store.getState().stopRecording();
  const writes = storage.setItem.mock.calls.length;
  advance('2026-10-17T02:00:00.000Z');
  await store.getState().updateHeartbeat();
  expect(storage.setItem).toHaveBeenCalledTimes(writes);
  await store.getState().recordAppStart('2026-10-17T02:00:00.000Z');
  expect(persisted().appLifetimeRecords).toEqual([
    { startedAt: '2026-10-17T02:00:00.000Z', lastHeartbeat: '2026-10-17T02:00:00.000Z' },
    { startedAt: START, lastHeartbeat: LATER },
  ]);
});
