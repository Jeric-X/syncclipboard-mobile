import { AppState, type AppStateStatus } from 'react-native';
import { createClientFromConfig } from '@/services/ClientFactory';
import { configService } from '@/services/ConfigService';
import { DEFAULT_APP_CONFIG } from '@/types/storage';
import { clearResumeTextBaseline, syncResumeText } from '@/services/sync/iosResumeTextSync';
import { installIosResumeTextSync, runIosTextAction } from '@/services/sync/iosResumeTextRuntime';

jest.mock('@/i18n', () => ({ t: (key: string) => key }));
jest.mock('@/services/ConfigService', () => ({
  configService: { subscribe: jest.fn(), getConfig: jest.fn() },
}));
jest.mock('@/services/ClientFactory', () => ({ createClientFromConfig: jest.fn() }));
jest.mock('@/services/sync/iosResumeTextSync', () => ({
  syncResumeText: jest.fn(),
  clearResumeTextBaseline: jest.fn(),
  resumeTargetIdentity: JSON.stringify,
}));

jest.mock('@/services/clipboard/ClipboardMonitor', () => ({
  clipboardMonitor: { setLastContent: jest.fn(), reset: jest.fn() },
}));
jest.mock('@/stores/localClipboardStore', () => ({
  useLocalClipboardStore: { getState: jest.fn(), setState: jest.fn() },
}));

const config = {
  ...DEFAULT_APP_CONFIG,
  activeServerIndex: 0,
  autoSync: true,
  servers: [{ id: 'home', type: 'webdav' as const, url: 'https://home.example' }],
};
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

it('checks once per real resume and cancels old work on background or configuration changes', async () => {
  let change!: (state: AppStateStatus) => void;
  const remove = jest.fn();
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, handler) => {
      change = handler;
      return { remove };
    });
  const unsubscribe = jest.fn();
  jest.mocked(configService.subscribe).mockReturnValue(unsubscribe);
  jest.mocked(configService.getConfig).mockResolvedValue(config);
  const stop = installIosResumeTextSync();
  try {
    change('active');
    change('inactive');
    change('active');
    await flush();
    expect(syncResumeText).not.toHaveBeenCalled();
    change('background');
    change('inactive');
    change('active');
    change('inactive');
    change('active');
    await flush();
    expect(syncResumeText).toHaveBeenCalledTimes(1);
    const first = jest.mocked(syncResumeText).mock.calls[0][2];
    jest.mocked(configService.subscribe).mock.calls[0][0]({ ...config, debugMode: true });
    expect(first.aborted).toBe(false);
    change('background');
    expect(first.aborted).toBe(true);
    change('active');
    await flush();
    const second = jest.mocked(syncResumeText).mock.calls[1][2];
    jest.mocked(configService.subscribe).mock.calls[0][0]({ ...config, autoSync: false });
    expect(second.aborted).toBe(true);
    jest.mocked(configService.getConfig).mockResolvedValue({ ...config, autoSync: false });
    change('background');
    change('active');
    await flush();
    expect(syncResumeText).toHaveBeenCalledTimes(2);
  } finally {
    stop();
    listener.mockRestore();
  }
  expect(remove).toHaveBeenCalled();
  expect(unsubscribe).toHaveBeenCalled();
});

it('serializes manual actions and discards queued operations when the target changes', async () => {
  jest.clearAllMocks();
  let change!: (state: AppStateStatus) => void;
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, handler) => {
      change = handler;
      return { remove: jest.fn() };
    });
  jest.mocked(configService.getConfig).mockResolvedValue(config);
  jest.mocked(configService.subscribe).mockReturnValue(jest.fn());
  let finish!: () => void;
  jest.mocked(syncResumeText).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(undefined);
      })
  );
  const stop = installIosResumeTextSync();
  try {
    change('background');
    change('active');
    await flush();
    const manual = runIosTextAction('upload', 'home');
    expect(syncResumeText).toHaveBeenCalledTimes(1);
    change('background');
    change('active');
    jest.mocked(configService.subscribe).mock.calls[0][0]({
      ...config,
      servers: [{ ...config.servers[0], id: 'office' }],
    });
    finish();
    await manual;
    await flush();
    expect(syncResumeText).toHaveBeenCalledTimes(1);
    expect(clearResumeTextBaseline).toHaveBeenCalledTimes(1);
    await runIosTextAction('refresh', 'office');
    expect(syncResumeText).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'office' }),
      jest.mocked(createClientFromConfig).mock.results.at(-1)?.value,
      expect.anything(),
      'refresh',
      undefined
    );
  } finally {
    stop();
    listener.mockRestore();
  }
});
