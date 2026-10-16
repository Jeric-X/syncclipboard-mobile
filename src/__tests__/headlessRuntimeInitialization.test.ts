import { HeadlessRuntimeInitialization } from '../services/headless/headlessRuntimeInitialization';

test('UI waiters share one Headless initialization, including late waiters', async () => {
  const readiness = new HeadlessRuntimeInitialization();
  const initialize = jest.fn(async () => {});
  const waiting = readiness.wait('one');
  expect(initialize).not.toHaveBeenCalled();
  expect(readiness.initialize('one', initialize)).toBe(waiting);
  expect(readiness.initialize('one', initialize)).toBe(waiting);
  await waiting;
  await readiness.wait('one');
  expect(initialize).toHaveBeenCalledTimes(1);
});

test('initialization failure reaches both the task and UI', async () => {
  const readiness = new HeadlessRuntimeInitialization();
  const waiting = readiness.wait('one');
  const failure = new Error('config failed');
  const task = readiness.initialize('one', async () => {
    throw failure;
  });
  await expect(task).rejects.toBe(failure);
  await expect(waiting).rejects.toBe(failure);
});

test('ending a session cancels its waiters without ending the next session', async () => {
  const readiness = new HeadlessRuntimeInitialization();
  const old = readiness.wait('old');
  const next = readiness.initialize('new', async () => {});
  readiness.end('old');
  await expect(old).rejects.toThrow('ended before initialization');
  await expect(next).resolves.toBeUndefined();
});

test('session ending before initialization is dispatched does not start tasks', async () => {
  const readiness = new HeadlessRuntimeInitialization();
  const initialize = jest.fn(async () => {});
  const task = readiness.initialize('old', initialize);
  readiness.end('old');
  await expect(task).rejects.toThrow('ended before initialization');
  expect(initialize).not.toHaveBeenCalled();
});
