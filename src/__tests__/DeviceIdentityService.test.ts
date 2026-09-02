import { DeviceIdentityService } from '../services/DeviceIdentityService';
import { STORAGE_KEYS } from '../types/storage';

describe('DeviceIdentityService', () => {
  const generatedId = '123e4567-e89b-42d3-a456-426614174000';

  it('generates and persists one UUID on first use', async () => {
    const storage = {
      getItem: jest.fn().mockResolvedValue(null),
      setItem: jest.fn().mockResolvedValue(undefined),
    };
    const generateUuid = jest.fn(() => generatedId);
    const service = new DeviceIdentityService(storage, generateUuid);

    await expect(service.getDeviceId()).resolves.toBe(generatedId);
    await expect(service.getDeviceId()).resolves.toBe(generatedId);

    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.getItem).toHaveBeenCalledWith(STORAGE_KEYS.DEVICE_ID);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEYS.DEVICE_ID, generatedId);
    expect(generateUuid).toHaveBeenCalledTimes(1);
  });

  it('reuses a persisted UUID without generating a replacement', async () => {
    const storage = {
      getItem: jest.fn().mockResolvedValue(generatedId),
      setItem: jest.fn().mockResolvedValue(undefined),
    };
    const generateUuid = jest.fn(() => '00000000-0000-4000-8000-000000000000');
    const service = new DeviceIdentityService(storage, generateUuid);

    await expect(service.getDeviceId()).resolves.toBe(generatedId);

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(generateUuid).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent first-use requests', async () => {
    const storage = {
      getItem: jest.fn().mockResolvedValue(null),
      setItem: jest.fn().mockResolvedValue(undefined),
    };
    const generateUuid = jest.fn(() => generatedId);
    const service = new DeviceIdentityService(storage, generateUuid);

    await expect(
      Promise.all([service.getDeviceId(), service.getDeviceId(), service.getDeviceId()])
    ).resolves.toEqual([generatedId, generatedId, generatedId]);

    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(generateUuid).toHaveBeenCalledTimes(1);
  });
});
