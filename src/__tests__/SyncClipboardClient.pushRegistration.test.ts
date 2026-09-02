jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('../utils/index', () => ({
  isTextInvalid: jest.fn(() => false),
}));

import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { SyncClipboardClient } from '../api/clients/SyncClipboardClient';
import type { PushDeviceRegistrationRequest, RealtimeCapabilities } from '../types/api';

class InspectableSyncClipboardClient extends SyncClipboardClient {
  readonly putRequests: Array<{ url: string; data: unknown; config?: AxiosRequestConfig }> = [];
  readonly deleteRequests: Array<{ url: string; config?: AxiosRequestConfig }> = [];

  setCapabilitiesResponse(status: number, data: unknown): void {
    this.client.get = jest.fn().mockResolvedValue({ status, data } as AxiosResponse);
  }

  protected override async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    this.putRequests.push({ url, data, config });
    return undefined as T;
  }

  protected override async delete<T = unknown>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<T> {
    this.deleteRequests.push({ url, config });
    return undefined as T;
  }
}

describe('SyncClipboardClient push registration API', () => {
  const deviceId = '123e4567-e89b-42d3-a456-426614174000';
  const registration: PushDeviceRegistrationRequest = {
    platform: 'android',
    provider: 'fcm',
    token: 'push-token',
    appVersion: '1.0.0',
  };

  it('maps a legacy capabilities 404 to push unsupported', async () => {
    const client = new InspectableSyncClipboardClient({ baseURL: 'https://sync.example' });
    client.setCapabilitiesResponse(404, null);

    await expect(client.getRealtimeCapabilities()).resolves.toBeNull();
  });

  it('normalizes the capability response to explicit booleans', async () => {
    const client = new InspectableSyncClipboardClient({ baseURL: 'https://sync.example' });
    client.setCapabilitiesResponse(200, {
      signalR: true,
      push: { fcm: true },
    } satisfies RealtimeCapabilities);

    await expect(client.getRealtimeCapabilities()).resolves.toEqual({
      signalR: true,
      push: { fcm: true },
    });
  });

  it('uses idempotent device-scoped PUT and DELETE endpoints', async () => {
    const client = new InspectableSyncClipboardClient({ baseURL: 'https://sync.example' });
    const signal = new AbortController().signal;

    await client.registerPushDevice(deviceId, registration, signal);
    await client.unregisterPushDevice(deviceId, signal);

    expect(client.putRequests).toEqual([
      {
        url: `/api/devices/${deviceId}/push`,
        data: registration,
        config: { signal },
      },
    ]);
    expect(client.deleteRequests).toEqual([
      {
        url: `/api/devices/${deviceId}/push`,
        config: { signal },
      },
    ]);
  });
});
