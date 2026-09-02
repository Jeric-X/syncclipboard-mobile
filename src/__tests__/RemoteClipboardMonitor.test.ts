jest.mock('signalr-client', () => ({
  getSignalRClient: jest.fn(),
}));

jest.mock('../services/ConfigService', () => ({
  configService: {
    getActiveServer: jest.fn(),
    getConfig: jest.fn(),
  },
}));

jest.mock('../services/ClientFactory', () => ({
  getAPIClient: jest.fn(),
}));

jest.mock('../services/sync/SyncState', () => ({
  clipboardSyncState: {
    clearSyncError: jest.fn(),
    setSyncError: jest.fn(),
  },
}));

jest.mock('native-timer', () => ({
  setTimer: jest.fn(),
  clearTimer: jest.fn(),
}));

jest.mock('../services/sync/PushEventSource', () => ({
  PushEventSource: jest.fn(),
}));

import { getAPIClient } from '../services/ClientFactory';
import { configService } from '../services/ConfigService';
import {
  RemoteClipboardMonitor,
  type RemoteEventSourceFactory,
} from '../services/sync/RemoteClipboardMonitor';
import type {
  RemoteEventSource,
  RemoteEventSourceConnectionState,
  RemoteProfileChangeHint,
} from '../services/sync/RemoteEventSource';
import type { ProfileDto, ServerConfig } from '../types/api';

class FakeRemoteEventSource implements RemoteEventSource {
  private connected = false;
  private readonly profileCallbacks = new Set<(hint: RemoteProfileChangeHint) => void>();
  private readonly stateCallbacks = new Set<(state: RemoteEventSourceConnectionState) => void>();

  constructor(private readonly connectsSuccessfully = true) {}

  readonly connect = jest.fn(async () => {
    this.connected = this.connectsSuccessfully;
  });

  readonly disconnect = jest.fn(async () => {
    this.connected = false;
  });

  isConnected(): boolean {
    return this.connected;
  }

  onProfileChanged(callback: (hint: RemoteProfileChangeHint) => void): () => void {
    this.profileCallbacks.add(callback);
    return () => this.profileCallbacks.delete(callback);
  }

  onConnectionStateChanged(
    callback: (state: RemoteEventSourceConnectionState) => void
  ): () => void {
    this.stateCallbacks.add(callback);
    return () => this.stateCallbacks.delete(callback);
  }

  emitProfileChanged(hint: RemoteProfileChangeHint): void {
    this.profileCallbacks.forEach((callback) => callback(hint));
  }

  emitConnectionState(state: RemoteEventSourceConnectionState): void {
    this.connected = state === 'CONNECTED';
    this.stateCallbacks.forEach((callback) => callback(state));
  }

  get profileCallbackCount(): number {
    return this.profileCallbacks.size;
  }
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe('RemoteClipboardMonitor event transport', () => {
  const server: ServerConfig = {
    type: 'syncclipboard',
    url: 'https://sync.example',
  };
  const initialProfile: ProfileDto = {
    type: 'Text',
    hash: 'initial-hash',
    text: 'initial',
    hasData: false,
  };
  const changedProfile: ProfileDto = {
    type: 'Text',
    hash: 'changed-hash',
    text: 'authoritative HTTP value',
    hasData: false,
  };
  const mockedConfig = configService as jest.Mocked<typeof configService>;
  const mockedGetAPIClient = getAPIClient as jest.MockedFunction<typeof getAPIClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedConfig.getActiveServer.mockResolvedValue(server);
    mockedConfig.getConfig.mockResolvedValue({
      remotePollingInterval: 3000,
      enableHistorySync: false,
    } as never);
  });

  it('fetches authoritative HTTP state after a SignalR change hint', async () => {
    const source = new FakeRemoteEventSource();
    const sourceFactory: RemoteEventSourceFactory = jest.fn(() => source);
    const getClipboard = jest
      .fn()
      .mockResolvedValueOnce(initialProfile)
      .mockResolvedValueOnce(changedProfile);
    mockedGetAPIClient.mockResolvedValue({ getClipboard } as never);
    const pushSource = new FakeRemoteEventSource();
    const pushSourceFactory: RemoteEventSourceFactory = jest.fn(() => pushSource);
    const monitor = new RemoteClipboardMonitor(sourceFactory, pushSourceFactory);
    const callback = jest.fn();
    monitor.addCallback(callback);

    await monitor.resumeAndRefresh();
    expect(callback).toHaveBeenLastCalledWith(
      expect.objectContaining({ profileHash: 'initial-hash', text: 'initial' })
    );
    callback.mockClear();

    source.emitProfileChanged({ hash: 'changed-hash' });
    await flushPromises();

    expect(getClipboard).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        profileHash: 'changed-hash',
        text: 'authoritative HTTP value',
      })
    );

    source.emitProfileChanged({ hash: 'changed-hash' });
    await flushPromises();
    expect(getClipboard).toHaveBeenCalledTimes(2);

    await monitor.disconnect();
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(pushSource.disconnect).toHaveBeenCalledTimes(1);
    expect(source.profileCallbackCount).toBe(0);
    expect(pushSource.profileCallbackCount).toBe(0);
  });

  it('fetches authoritative HTTP state after an FCM hash-only hint', async () => {
    const signalRSource = new FakeRemoteEventSource();
    const pushSource = new FakeRemoteEventSource();
    const getClipboard = jest
      .fn()
      .mockResolvedValueOnce(initialProfile)
      .mockResolvedValueOnce(changedProfile);
    mockedGetAPIClient.mockResolvedValue({ getClipboard } as never);
    const monitor = new RemoteClipboardMonitor(
      () => signalRSource,
      () => pushSource
    );
    const callback = jest.fn();
    monitor.addCallback(callback);

    await monitor.resumeAndRefresh();
    callback.mockClear();
    pushSource.emitProfileChanged({ hash: 'changed-hash' });
    await flushPromises();

    expect(getClipboard).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        profileHash: 'changed-hash',
        text: 'authoritative HTTP value',
      })
    );
  });

  it('switches to push-only background mode only after push registration succeeds', async () => {
    const signalRSource = new FakeRemoteEventSource();
    const pushSource = new FakeRemoteEventSource();
    const getClipboard = jest.fn().mockResolvedValue(initialProfile);
    mockedGetAPIClient.mockResolvedValue({
      getClipboard,
    } as never);
    const monitor = new RemoteClipboardMonitor(
      () => signalRSource,
      () => pushSource
    );
    monitor.addBackgroundRunningChecker(() => true);

    await monitor.resumeAndRefresh();
    await monitor.handleBackground();

    expect(signalRSource.disconnect).toHaveBeenCalledTimes(1);
    expect(pushSource.disconnect).not.toHaveBeenCalled();
    expect(monitor.isSignalRConnected()).toBe(false);
    expect(monitor.isPushConnected()).toBe(true);
    expect(monitor.isConnected()).toBe(true);

    await monitor.handleForeground();
    expect(signalRSource.connect).toHaveBeenCalledTimes(2);
    expect(monitor.isSignalRConnected()).toBe(true);
    expect(getClipboard).toHaveBeenCalledTimes(2);
  });

  it('preserves SignalR background behavior when push registration is unavailable', async () => {
    const signalRSource = new FakeRemoteEventSource();
    const unavailablePushSource = new FakeRemoteEventSource(false);
    mockedGetAPIClient.mockResolvedValue({
      getClipboard: jest.fn().mockResolvedValue(initialProfile),
    } as never);
    const monitor = new RemoteClipboardMonitor(
      () => signalRSource,
      () => unavailablePushSource
    );
    monitor.addBackgroundRunningChecker(() => true);

    await monitor.connect();
    await monitor.handleBackground();

    expect(signalRSource.disconnect).not.toHaveBeenCalled();
    expect(unavailablePushSource.disconnect).not.toHaveBeenCalled();
    expect(monitor.isSignalRConnected()).toBe(true);
    expect(monitor.isPushConnected()).toBe(false);
  });

  it('preserves SignalR in background when history realtime notifications are enabled', async () => {
    const signalRSource = new FakeRemoteEventSource();
    const pushSource = new FakeRemoteEventSource();
    mockedConfig.getConfig.mockResolvedValue({
      remotePollingInterval: 3000,
      enableHistorySync: true,
    } as never);
    mockedGetAPIClient.mockResolvedValue({
      getClipboard: jest.fn().mockResolvedValue(initialProfile),
    } as never);
    const monitor = new RemoteClipboardMonitor(
      () => signalRSource,
      () => pushSource
    );
    monitor.addBackgroundRunningChecker(() => true);

    await monitor.resumeAndRefresh();
    await monitor.handleBackground();

    expect(signalRSource.disconnect).not.toHaveBeenCalled();
    expect(monitor.isSignalRConnected()).toBe(true);
  });

  it('restores SignalR immediately when push registration drops in background', async () => {
    const signalRSource = new FakeRemoteEventSource();
    const pushSource = new FakeRemoteEventSource();
    mockedGetAPIClient.mockResolvedValue({
      getClipboard: jest.fn().mockResolvedValue(initialProfile),
    } as never);
    const monitor = new RemoteClipboardMonitor(
      () => signalRSource,
      () => pushSource
    );
    monitor.addBackgroundRunningChecker(() => true);

    await monitor.resumeAndRefresh();
    await monitor.handleBackground();
    expect(monitor.isSignalRConnected()).toBe(false);

    pushSource.emitConnectionState('DISCONNECTED');
    await flushPromises();

    expect(signalRSource.connect).toHaveBeenCalledTimes(2);
    expect(monitor.isSignalRConnected()).toBe(true);
  });

  it('runs one follow-up fetch when a newer hint arrives during an authoritative fetch', async () => {
    const signalRSource = new FakeRemoteEventSource();
    const pushSource = new FakeRemoteEventSource();
    let resolveFirstHint: ((profile: ProfileDto) => void) | undefined;
    const getClipboard = jest
      .fn()
      .mockResolvedValueOnce(initialProfile)
      .mockImplementationOnce(
        () => new Promise<ProfileDto>((resolve) => (resolveFirstHint = resolve))
      )
      .mockResolvedValueOnce(changedProfile);
    mockedGetAPIClient.mockResolvedValue({ getClipboard } as never);
    const monitor = new RemoteClipboardMonitor(
      () => signalRSource,
      () => pushSource
    );
    const callback = jest.fn();
    monitor.addCallback(callback);
    await monitor.resumeAndRefresh();
    callback.mockClear();

    signalRSource.emitProfileChanged({ hash: 'intermediate-hash' });
    await flushPromises();
    pushSource.emitProfileChanged({ hash: 'changed-hash' });
    resolveFirstHint?.({
      type: 'Text',
      hash: 'intermediate-hash',
      text: 'intermediate',
      hasData: false,
    });
    await flushPromises();

    expect(getClipboard).toHaveBeenCalledTimes(3);
    expect(callback).toHaveBeenLastCalledWith(
      expect.objectContaining({ profileHash: 'changed-hash' })
    );
  });

  it('does not block authoritative refresh on optional push setup', async () => {
    const signalRSource = new FakeRemoteEventSource();
    const pushSource = new FakeRemoteEventSource();
    let finishPushSetup: (() => void) | undefined;
    pushSource.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishPushSetup = () => {
            pushSource.emitConnectionState('CONNECTED');
            resolve();
          };
        })
    );
    const getClipboard = jest.fn().mockResolvedValue(initialProfile);
    mockedGetAPIClient.mockResolvedValue({ getClipboard } as never);
    const monitor = new RemoteClipboardMonitor(
      () => signalRSource,
      () => pushSource
    );

    await expect(monitor.resumeAndRefresh()).resolves.toBeUndefined();

    expect(getClipboard).toHaveBeenCalledTimes(1);
    expect(pushSource.connect).toHaveBeenCalledTimes(1);
    finishPushSetup?.();
    await flushPromises();
  });

  it('publishes push registration state for foreground service policy', async () => {
    const signalRSource = new FakeRemoteEventSource();
    const pushSource = new FakeRemoteEventSource();
    mockedGetAPIClient.mockResolvedValue({
      getClipboard: jest.fn().mockResolvedValue(initialProfile),
    } as never);
    const monitor = new RemoteClipboardMonitor(
      () => signalRSource,
      () => pushSource
    );
    const states: boolean[] = [];
    monitor.addPushRegistrationStateListener((active) => states.push(active));

    await monitor.connect();
    expect(states).toContain(true);

    await monitor.disconnect();
    expect(states.at(-1)).toBe(false);
  });

  it('disconnects both transports when background remote sync is disabled', async () => {
    const signalRSource = new FakeRemoteEventSource();
    const pushSource = new FakeRemoteEventSource();
    mockedGetAPIClient.mockResolvedValue({
      getClipboard: jest.fn().mockResolvedValue(initialProfile),
    } as never);
    const monitor = new RemoteClipboardMonitor(
      () => signalRSource,
      () => pushSource
    );

    await monitor.connect();
    await monitor.handleBackground();

    expect(signalRSource.disconnect).toHaveBeenCalledTimes(1);
    expect(pushSource.disconnect).toHaveBeenCalledTimes(1);
    expect(monitor.isConnected()).toBe(false);
  });
});
