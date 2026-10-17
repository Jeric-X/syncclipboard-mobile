import { createStatisticsStore, MAX_STATISTICS_RECORDS } from '../stores/statisticsStore';

const START = '2026-10-17T01:00:00.000Z';
const LATER = '2026-10-17T01:01:00.000Z';

function setup(raw: string | Map<string, string> | null = null) {
  const values = raw instanceof Map ? new Map(raw) : new Map(raw ? [['@statistics', raw]] : []);
  let time = START;
  const storage = {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
  const store = createStatisticsStore({ storage, now: () => new Date(time) });
  return {
    store,
    storage,
    values,
    advance: (value: string) => {
      time = value;
    },
    persisted: async () => {
      const reloaded = createStatisticsStore({ storage, now: () => new Date(time) });
      await reloaded.getState().load();
      return reloaded.getState().data;
    },
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
  expect(storage.getItem).toHaveBeenCalledTimes(2);
  expect((await persisted()).appLifetimeRecords).toEqual([
    { startedAt: START, lastHeartbeat: LATER },
  ]);
});

it('preserves previous runtime records without extending them on the next launch', async () => {
  const first = setup();
  await first.store.getState().recordAppStart(START);
  first.advance(LATER);
  await first.store.getState().updateHeartbeat();
  const second = setup(first.values);
  second.advance('2026-10-18T01:00:00.000Z');
  await second.store.getState().recordAppStart('2026-10-18T01:00:00.000Z');
  expect((await second.persisted()).appLifetimeRecords).toEqual([
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
  const saved = (await persisted()).appLifetimeRecords;
  expect(saved).toHaveLength(MAX_STATISTICS_RECORDS);
  expect(saved[0].startedAt).toBe(LATER);
  expect(saved.at(-1)).toEqual(records[MAX_STATISTICS_RECORDS - 2]);
});

it('migrates old background records and labels them separately', async () => {
  const { store, persisted, values } = setup(
    JSON.stringify({ backgroundTaskRecords: [{ startedAt: START, lastHeartbeat: LATER }] })
  );
  await store.getState().recordAppStart(START);
  expect((await persisted()).appLifetimeRecords[1].legacyBackground).toBe(true);
  expect(JSON.parse(values.get('@statistics')!).backgroundTaskRecords).toBeUndefined();
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
  expect((await persisted()).appLifetimeRecords).toEqual([]);
  expect(store.getState().data.appLifetimeRecords).toEqual([]);
  advance('2026-10-17T01:02:00.000Z');
  await store.getState().updateHeartbeat();
  expect((await persisted()).appLifetimeRecords).toEqual([
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
  expect((await persisted()).appLifetimeRecords).toEqual([]);
});

it('retries after a storage error without losing old records or duplicating the new start', async () => {
  const { store, storage, persisted } = setup();
  storage.getItem.mockRejectedValueOnce(new Error('read failed'));
  await expect(store.getState().recordAppStart(START)).rejects.toThrow('read failed');
  expect(storage.setItem).not.toHaveBeenCalled();
  storage.setItem.mockRejectedValueOnce(new Error('write failed'));
  await expect(store.getState().recordAppStart(START)).rejects.toThrow('write failed');
  await store.getState().recordAppStart(START);
  expect((await persisted()).appLifetimeRecords).toHaveLength(1);
});

it('keeps current data when clearing fails', async () => {
  const { store, storage, advance, persisted } = setup();
  await store.getState().recordAppStart(START);
  advance(LATER);
  storage.setItem.mockRejectedValueOnce(new Error('write failed'));
  await expect(store.getState().clear()).rejects.toThrow();
  expect(store.getState().data.appLifetimeRecords).toHaveLength(1);
  await store.getState().updateHeartbeat();
  expect((await persisted()).appLifetimeRecords[0].startedAt).toBe(START);
});

it.each([
  'invalid json',
  'null',
  '{"appLifetimeRecords":[null,{}, {"startedAt":"bad","lastHeartbeat":"bad"}]}',
])('recovers from malformed persisted data: %s', async (raw) => {
  const { store, persisted } = setup(raw);
  await store.getState().recordAppStart(START);
  expect((await persisted()).appLifetimeRecords).toEqual([
    { startedAt: START, lastHeartbeat: START },
  ]);
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
  expect((await persisted()).appLifetimeRecords).toEqual([
    { startedAt: '2026-10-17T02:00:00.000Z', lastHeartbeat: '2026-10-17T02:00:00.000Z' },
    { startedAt: START, lastHeartbeat: LATER },
  ]);
});

it('writes a bounded heartbeat payload even when history contains 10000 records', async () => {
  const records = Array.from({ length: MAX_STATISTICS_RECORDS }, () => ({
    startedAt: START,
    lastHeartbeat: START,
  }));
  const { store, storage, advance } = setup(JSON.stringify({ appLifetimeRecords: records }));
  await store.getState().recordAppStart(START);
  storage.setItem.mockClear();
  advance(LATER);
  await store.getState().updateHeartbeat();
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  expect(storage.setItem.mock.calls[0][1].length).toBeLessThan(256);
  expect(store.getState().data.appLifetimeRecords).toHaveLength(MAX_STATISTICS_RECORDS);
});

it('keeps the persisted history snapshot unchanged across heartbeat updates and restores the latest heartbeat', async () => {
  const { store, values, advance, persisted } = setup();
  await store.getState().recordAppStart(START);
  const snapshot = values.get('@statistics');
  advance(LATER);
  await store.getState().updateHeartbeat();
  advance('2026-10-17T01:02:00.000Z');
  await store.getState().updateHeartbeat();
  expect(values.get('@statistics')).toBe(snapshot);
  expect((await persisted()).appLifetimeRecords).toEqual([
    { startedAt: START, lastHeartbeat: '2026-10-17T01:02:00.000Z' },
  ]);
});

it('ignores the old heartbeat after clearing, including when killed before the next heartbeat', async () => {
  const { store, values, advance, persisted } = setup();
  await store.getState().recordAppStart(START);
  advance(LATER);
  await store.getState().updateHeartbeat();
  const heartbeat = values.get('@statistics/heartbeat');
  await store.getState().clear();
  expect(values.get('@statistics/heartbeat')).toBe(heartbeat);
  expect((await persisted()).appLifetimeRecords).toEqual([]);
  advance('2026-10-17T01:02:00.000Z');
  await store.getState().updateHeartbeat();
  expect((await persisted()).appLifetimeRecords).toEqual([
    { startedAt: LATER, lastHeartbeat: '2026-10-17T01:02:00.000Z' },
  ]);
});

it('does not replace the old persisted heartbeat if a heartbeat write fails', async () => {
  const { store, storage, advance, persisted } = setup();
  await store.getState().recordAppStart(START);
  advance(LATER);
  await store.getState().updateHeartbeat();
  advance('2026-10-17T01:02:00.000Z');
  storage.setItem.mockRejectedValueOnce(new Error('disk full'));
  await expect(store.getState().updateHeartbeat()).rejects.toThrow('disk full');
  expect((await persisted()).appLifetimeRecords[0].lastHeartbeat).toBe(LATER);
  expect(store.getState().data.appLifetimeRecords[0].lastHeartbeat).toBe(LATER);
  await store.getState().updateHeartbeat();
  expect((await persisted()).appLifetimeRecords[0].lastHeartbeat).toBe('2026-10-17T01:02:00.000Z');
});

it.each([
  'null',
  'broken',
  '{"revision":1,"record":{}}',
  '{"revision":1,"record":{"startedAt":"2026-01-01T00:00:00.000Z","lastHeartbeat":"2026-10-17T01:01:00.000Z"}}',
])('preserves a snapshot when its separate heartbeat is corrupt or mismatched: %s', async (raw) => {
  const { store, values, persisted } = setup();
  await store.getState().recordAppStart(START);
  values.set('@statistics/heartbeat', raw);
  expect((await persisted()).appLifetimeRecords).toEqual([
    { startedAt: START, lastHeartbeat: START },
  ]);
});
