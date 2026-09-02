jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.2.3',
}));

jest.mock('push-event-source', () => ({
  addProfileChangedListener: jest.fn(),
  addTokenChangedListener: jest.fn(),
  consumePendingProfileChangeHint: jest.fn(),
  getToken: jest.fn(),
  isFirebaseConfigured: jest.fn(),
}));

jest.mock('../services/ClientFactory', () => ({
  createClientFromConfig: jest.fn(),
}));

jest.mock('../services/DeviceIdentityService', () => ({
  deviceIdentityService: { getDeviceId: jest.fn() },
}));

jest.mock('../utils/index', () => ({
  isTextInvalid: jest.fn(() => false),
}));

import type { EventSubscription } from 'expo-modules-core';
import {
  PushEventSource,
  type NativePushEventGateway,
  type PushRegistrationClient,
} from '../services/sync/PushEventSource';
import type { NativePushProfileChangeHint } from 'push-event-source';
import type { ServerConfig } from '../types/api';

class FakeNativePushEventGateway implements NativePushEventGateway {
  configured = true;
  token: string | null = 'push-token';
  pendingHint: NativePushProfileChangeHint | null = null;
  private profileListener: ((hint: NativePushProfileChangeHint) => void) | null = null;
  private tokenListener: (() => void) | null = null;

  isFirebaseConfigured(): boolean {
    return this.configured;
  }

  async getToken(): Promise<string | null> {
    return this.token;
  }

  consumePendingProfileChangeHint(): NativePushProfileChangeHint | null {
    const hint = this.pendingHint;
    this.pendingHint = null;
    return hint;
  }

  addProfileChangedListener(
    listener: (hint: NativePushProfileChangeHint) => void
  ): EventSubscription {
    this.profileListener = listener;
    return { remove: () => (this.profileListener = null) };
  }

  addTokenChangedListener(listener: () => void): EventSubscription {
    this.tokenListener = listener;
    return { remove: () => (this.tokenListener = null) };
  }

  emitProfileChanged(hash: string): void {
    this.profileListener?.({ hash });
  }

  emitTokenChanged(): void {
    this.tokenListener?.();
  }
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe('PushEventSource', () => {
  const server: ServerConfig = {
    type: 'syncclipboard',
    url: 'https://sync.example',
  };
  const deviceId = '123e4567-e89b-42d3-a456-426614174000';

  function createClient(fcm = true): jest.Mocked<PushRegistrationClient> {
    return {
      getRealtimeCapabilities: jest.fn().mockResolvedValue({
        signalR: true,
        push: { fcm },
      }),
      registerPushDevice: jest.fn().mockResolvedValue(undefined),
      unregisterPushDevice: jest.fn().mockResolvedValue(undefined),
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it('registers the token only when native and server FCM support are available', async () => {
    const nativeGateway = new FakeNativePushEventGateway();
    const client = createClient();
    const source = new PushEventSource(
      server,
      nativeGateway,
      () => client,
      async () => deviceId
    );

    await source.connect();

    expect(source.isConnected()).toBe(true);
    expect(client.registerPushDevice).toHaveBeenCalledWith(deviceId, {
      platform: 'android',
      provider: 'fcm',
      token: 'push-token',
      appVersion: '1.2.3',
    });
    expect(client.registerPushDevice.mock.calls[0][1]).not.toHaveProperty('text');

    await source.disconnect();
    expect(client.unregisterPushDevice).toHaveBeenCalledWith(deviceId);
  });

  it('keeps push unavailable without native Firebase configuration', async () => {
    const nativeGateway = new FakeNativePushEventGateway();
    nativeGateway.configured = false;
    const clientFactory = jest.fn(() => createClient());
    const source = new PushEventSource(server, nativeGateway, clientFactory);

    await source.connect();

    expect(source.isConnected()).toBe(false);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('treats a legacy or non-FCM server as unsupported without registration', async () => {
    const nativeGateway = new FakeNativePushEventGateway();
    const client = createClient(false);
    const source = new PushEventSource(
      server,
      nativeGateway,
      () => client,
      async () => deviceId
    );

    await source.connect();

    expect(source.isConnected()).toBe(false);
    expect(client.registerPushDevice).not.toHaveBeenCalled();
  });

  it('retries a transient registration failure without duplicating native listeners', async () => {
    const nativeGateway = new FakeNativePushEventGateway();
    const addProfileChangedListener = jest.spyOn(nativeGateway, 'addProfileChangedListener');
    const addTokenChangedListener = jest.spyOn(nativeGateway, 'addTokenChangedListener');
    const client = createClient();
    client.getRealtimeCapabilities
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ signalR: true, push: { fcm: true } });
    const source = new PushEventSource(
      server,
      nativeGateway,
      () => client,
      async () => deviceId
    );

    await source.connect();
    expect(source.isConnected()).toBe(false);

    await source.connect();

    expect(source.isConnected()).toBe(true);
    expect(client.registerPushDevice).toHaveBeenCalledTimes(1);
    expect(addProfileChangedListener).toHaveBeenCalledTimes(1);
    expect(addTokenChangedListener).toHaveBeenCalledTimes(1);
  });

  it('emits live and latest pending hash-only hints', async () => {
    const nativeGateway = new FakeNativePushEventGateway();
    nativeGateway.pendingHint = { hash: 'pending-hash' };
    const client = createClient();
    const source = new PushEventSource(
      server,
      nativeGateway,
      () => client,
      async () => deviceId
    );
    const callback = jest.fn();
    source.onProfileChanged(callback);

    await source.connect();
    nativeGateway.emitProfileChanged('live-hash');

    expect(callback).toHaveBeenNthCalledWith(1, { hash: 'pending-hash' });
    expect(callback).toHaveBeenNthCalledWith(2, { hash: 'live-hash' });
  });

  it('upserts the latest token after onNewToken without exposing it in the event', async () => {
    const nativeGateway = new FakeNativePushEventGateway();
    const client = createClient();
    const source = new PushEventSource(
      server,
      nativeGateway,
      () => client,
      async () => deviceId
    );
    await source.connect();
    nativeGateway.token = 'replacement-token';

    nativeGateway.emitTokenChanged();
    await flushPromises();

    expect(client.registerPushDevice).toHaveBeenLastCalledWith(
      deviceId,
      expect.objectContaining({ token: 'replacement-token' })
    );
    expect(source.isConnected()).toBe(true);
  });

  it('publishes registration state changes for background power policy', async () => {
    const nativeGateway = new FakeNativePushEventGateway();
    const client = createClient();
    const source = new PushEventSource(
      server,
      nativeGateway,
      () => client,
      async () => deviceId
    );
    const stateCallback = jest.fn();
    source.onConnectionStateChanged(stateCallback);

    await source.connect();
    expect(stateCallback).toHaveBeenLastCalledWith('CONNECTED');

    nativeGateway.token = 'replacement-token';
    nativeGateway.emitTokenChanged();
    await flushPromises();

    expect(stateCallback).toHaveBeenCalledWith('DISCONNECTED');
    expect(stateCallback).toHaveBeenLastCalledWith('CONNECTED');

    await source.disconnect();
    expect(stateCallback).toHaveBeenLastCalledWith('DISCONNECTED');
  });

  it('logs sanitized registration diagnostics without the push token', async () => {
    const nativeGateway = new FakeNativePushEventGateway();
    const client = createClient();
    client.registerPushDevice.mockRejectedValue({
      name: 'NetworkError',
      originalError: { config: { data: 'push-token' } },
    });
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const source = new PushEventSource(
      server,
      nativeGateway,
      () => client,
      async () => deviceId
    );

    await source.connect();

    expect(source.isConnected()).toBe(false);
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain('push-token');
    expect(consoleWarn).toHaveBeenCalledWith(
      '[PushEventSource] Push registration failed; SignalR fallback remains active:',
      { name: 'NetworkError' }
    );
    consoleWarn.mockRestore();
  });
});
