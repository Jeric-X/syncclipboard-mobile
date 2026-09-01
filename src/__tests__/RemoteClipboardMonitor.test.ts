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

  readonly connect = jest.fn(async () => {
    this.connected = true;
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
    mockedConfig.getConfig.mockResolvedValue({ remotePollingInterval: 3000 } as never);
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

    await monitor.connect();
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

    await monitor.connect();
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
});
