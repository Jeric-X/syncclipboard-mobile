import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { STORAGE_KEYS } from '../types/storage';

export const SYNC_DEVICE_ID_HEADER = 'X-SyncClipboard-Device-Id';

export interface DeviceIdentityStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Owns the stable, installation-scoped identity used by sync transport metadata. */
export class DeviceIdentityService {
  private deviceId: string | null = null;
  private loadPromise: Promise<string> | null = null;

  constructor(
    private readonly storage: DeviceIdentityStorage = AsyncStorage,
    private readonly generateUuid: () => string = () => Crypto.randomUUID()
  ) {}

  async getDeviceId(): Promise<string> {
    if (this.deviceId) return this.deviceId;
    if (this.loadPromise) return this.loadPromise;

    const loadPromise = this.loadOrCreateDeviceId();
    this.loadPromise = loadPromise;
    try {
      return await loadPromise;
    } finally {
      if (this.loadPromise === loadPromise) {
        this.loadPromise = null;
      }
    }
  }

  private async loadOrCreateDeviceId(): Promise<string> {
    const storedDeviceId = (await this.storage.getItem(STORAGE_KEYS.DEVICE_ID))?.trim();
    if (storedDeviceId && UUID_PATTERN.test(storedDeviceId)) {
      this.deviceId = storedDeviceId;
      return storedDeviceId;
    }
    if (storedDeviceId) {
      console.warn('[DeviceIdentityService] Replacing invalid persisted device identity');
    }

    const generatedDeviceId = this.generateUuid();
    if (!UUID_PATTERN.test(generatedDeviceId)) {
      throw new Error('Device identity generator returned an invalid UUID');
    }

    // Cache only after persistence succeeds so every returned ID is stable across restarts.
    await this.storage.setItem(STORAGE_KEYS.DEVICE_ID, generatedDeviceId);
    this.deviceId = generatedDeviceId;
    console.debug('[DeviceIdentityService] Generated and persisted device identity');
    return generatedDeviceId;
  }
}

export const deviceIdentityService = new DeviceIdentityService();
