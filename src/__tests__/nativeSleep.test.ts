import { nativeSleep, clearAllTimers } from 'native-timer';
import { requireNativeModule } from 'expo-modules-core';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-modules-core', () => ({ requireNativeModule: jest.fn() }));

const nativeModule = {
  startTimer: jest.fn(),
  stopTimer: jest.fn(),
  stopAllTimers: jest.fn(),
  addListener: jest.fn(),
};
let onTick: (event: { tag: string }) => void;
jest.mocked(requireNativeModule).mockReturnValue(nativeModule);
nativeModule.addListener.mockImplementation((_event, listener) => {
  onTick = listener;
  return { remove: jest.fn() };
});

beforeEach(() => {
  clearAllTimers();
  jest.clearAllMocks();
});

test('one native tick resolves the delay and clears its repeating timer', async () => {
  const waiting = nativeSleep(1000, new AbortController().signal);
  expect(nativeModule.startTimer).toHaveBeenCalledWith(expect.any(String), 1000);
  const tag = nativeModule.startTimer.mock.calls[0][0];
  nativeModule.stopTimer.mockClear();
  onTick({ tag });
  await waiting;
  expect(nativeModule.stopTimer).toHaveBeenCalledWith(tag);
});

test('cancellation resolves immediately and unregisters the timer', async () => {
  const controller = new AbortController();
  const waiting = nativeSleep(1000, controller.signal);
  const tag = nativeModule.startTimer.mock.calls[0][0];
  nativeModule.stopTimer.mockClear();
  controller.abort();
  await waiting;
  expect(nativeModule.stopTimer).toHaveBeenCalledWith(tag);
});

test('an already cancelled wait does not allocate a timer', async () => {
  const controller = new AbortController();
  controller.abort();
  await nativeSleep(1000, controller.signal);
  expect(nativeModule.startTimer).not.toHaveBeenCalled();
});
