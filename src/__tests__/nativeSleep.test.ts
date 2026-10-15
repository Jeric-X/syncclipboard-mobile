import { nativeSleep } from '../utils/nativeSleep';
import { clearTimer, setTimer } from 'native-timer';

jest.mock('native-timer', () => ({ setTimer: jest.fn(), clearTimer: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

test('one native tick resolves the delay and clears its repeating timer', async () => {
  let tick!: () => void;
  jest.mocked(setTimer).mockImplementation((callback) => {
    tick = callback;
    return 'native-wait';
  });
  const waiting = nativeSleep(1000, new AbortController().signal);
  expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 1000);
  tick();
  await waiting;
  expect(clearTimer).toHaveBeenCalledWith('native-wait');
});

test('cancellation resolves immediately and unregisters the timer', async () => {
  jest.mocked(setTimer).mockReturnValue('cancelled-wait');
  const controller = new AbortController();
  const waiting = nativeSleep(1000, controller.signal);
  controller.abort();
  await waiting;
  expect(clearTimer).toHaveBeenCalledWith('cancelled-wait');
});

test('an already cancelled wait does not allocate a timer', async () => {
  const controller = new AbortController();
  controller.abort();
  await nativeSleep(1000, controller.signal);
  expect(setTimer).not.toHaveBeenCalled();
});
