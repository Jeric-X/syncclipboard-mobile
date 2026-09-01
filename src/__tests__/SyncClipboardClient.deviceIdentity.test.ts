jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('../utils/index', () => ({
  isTextInvalid: jest.fn(() => false),
}));

jest.mock('../services/DeviceIdentityService', () => ({
  SYNC_DEVICE_ID_HEADER: 'X-SyncClipboard-Device-Id',
  deviceIdentityService: {
    getDeviceId: jest.fn(),
  },
}));

import type { AxiosRequestConfig } from 'axios';
import { SyncClipboardClient } from '../api/clients/SyncClipboardClient';
import { deviceIdentityService } from '../services/DeviceIdentityService';
import type { ProfileDto } from '../types/api';

const mockGetDeviceId = deviceIdentityService.getDeviceId as jest.Mock;

class InspectableSyncClipboardClient extends SyncClipboardClient {
  readonly putRequests: Array<{
    url: string;
    data: unknown;
    config: AxiosRequestConfig | undefined;
  }> = [];

  protected override async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    this.putRequests.push({ url, data, config });
    return undefined as T;
  }
}

describe('SyncClipboardClient device identity header', () => {
  const deviceId = '123e4567-e89b-42d3-a456-426614174000';
  const profile: ProfileDto = {
    type: 'Text',
    hash: 'profile-hash',
    text: 'clipboard',
    hasData: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds the persistent device ID to current clipboard uploads', async () => {
    mockGetDeviceId.mockResolvedValue(deviceId);
    const client = new InspectableSyncClipboardClient({ baseURL: 'https://sync.example' });
    const signal = new AbortController().signal;

    await client.putClipboard(profile, signal);

    expect(client.putRequests).toEqual([
      {
        url: '/SyncClipboard.json',
        data: profile,
        config: {
          signal,
          headers: { 'X-SyncClipboard-Device-Id': deviceId },
        },
      },
    ]);
  });

  it('preserves the legacy upload when device identity is unavailable', async () => {
    const storageError = new Error('storage unavailable');
    mockGetDeviceId.mockRejectedValue(storageError);
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const client = new InspectableSyncClipboardClient({ baseURL: 'https://sync.example' });

    await expect(client.putClipboard(profile)).resolves.toBeUndefined();

    expect(client.putRequests).toEqual([
      {
        url: '/SyncClipboard.json',
        data: profile,
        config: undefined,
      },
    ]);
    expect(consoleWarn).toHaveBeenCalledWith(
      '[SyncClipboardClient] Device identity unavailable; uploading without origin header:',
      storageError
    );
    consoleWarn.mockRestore();
  });
});
