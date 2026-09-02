import { APP_VERSION } from '@/constants';
import { SyncClipboardClient } from '@/api/clients/SyncClipboardClient';
import { createClientFromConfig } from '@/services/ClientFactory';
import { deviceIdentityService } from '@/services/DeviceIdentityService';
import type {
  PushDeviceRegistrationRequest,
  RealtimeCapabilities,
  ServerConfig,
} from '@/types/api';
import {
  addProfileChangedListener,
  addTokenChangedListener,
  consumePendingProfileChangeHint,
  getToken,
  isFirebaseConfigured,
  type NativePushProfileChangeHint,
} from 'push-event-source';
import type { EventSubscription } from 'expo-modules-core';
import type {
  RemoteEventSource,
  RemoteEventSourceConnectionState,
  RemoteProfileChangeHint,
} from './RemoteEventSource';

export interface PushRegistrationClient {
  getRealtimeCapabilities(signal?: AbortSignal): Promise<RealtimeCapabilities | null>;
  registerPushDevice(
    deviceId: string,
    registration: PushDeviceRegistrationRequest,
    signal?: AbortSignal
  ): Promise<void>;
  unregisterPushDevice(deviceId: string, signal?: AbortSignal): Promise<void>;
}

export interface NativePushEventGateway {
  isFirebaseConfigured(): boolean;
  getToken(): Promise<string | null>;
  consumePendingProfileChangeHint(): NativePushProfileChangeHint | null;
  addProfileChangedListener(
    listener: (hint: NativePushProfileChangeHint) => void
  ): EventSubscription;
  addTokenChangedListener(listener: () => void): EventSubscription;
}

export type PushRegistrationClientFactory = (server: ServerConfig) => PushRegistrationClient;

function errorDiagnostic(error: unknown): { name: string; statusCode?: number } {
  if (!error || typeof error !== 'object') return { name: typeof error };
  const value = error as { name?: unknown; statusCode?: unknown };
  return {
    name: typeof value.name === 'string' ? value.name : 'Error',
    ...(typeof value.statusCode === 'number' ? { statusCode: value.statusCode } : {}),
  };
}

const nativePushEventGateway: NativePushEventGateway = {
  isFirebaseConfigured,
  getToken,
  consumePendingProfileChangeHint,
  addProfileChangedListener,
  addTokenChangedListener,
};

const createPushRegistrationClient: PushRegistrationClientFactory = (server) => {
  const client = createClientFromConfig(server);
  if (!(client instanceof SyncClipboardClient)) {
    throw new Error('Push registration requires a SyncClipboard server');
  }
  return client;
};

/** Optional FCM hint transport. HTTP remains the authoritative clipboard state. */
export class PushEventSource implements RemoteEventSource {
  private readonly callbacks = new Set<(hint: RemoteProfileChangeHint) => void>();
  private readonly stateCallbacks = new Set<(state: RemoteEventSourceConnectionState) => void>();
  private subscriptions: EventSubscription[] = [];
  private registrationClient: PushRegistrationClient | null = null;
  private registrationDeviceId: string | null = null;
  private registrationQueue: Promise<void> = Promise.resolve();
  private connected = false;
  private lifecycle = 0;

  constructor(
    private readonly server: ServerConfig,
    private readonly nativeGateway: NativePushEventGateway = nativePushEventGateway,
    private readonly clientFactory: PushRegistrationClientFactory = createPushRegistrationClient,
    private readonly getDeviceId: () => Promise<string> = () => deviceIdentityService.getDeviceId()
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.subscriptions.length > 0) {
      await this.enqueueRegistration(this.lifecycle);
      return;
    }

    let configured = false;
    try {
      configured = this.nativeGateway.isFirebaseConfigured();
    } catch (error) {
      console.warn(
        '[PushEventSource] Failed to inspect Firebase availability:',
        errorDiagnostic(error)
      );
    }
    if (!configured) {
      console.debug('[PushEventSource] Firebase is not configured; push remains unavailable');
      return;
    }

    const lifecycle = ++this.lifecycle;
    this.registrationClient = this.clientFactory(this.server);
    this.subscriptions = [
      this.nativeGateway.addProfileChangedListener((hint) => this.emitProfileChanged(hint)),
      this.nativeGateway.addTokenChangedListener(() => {
        this.setConnected(false);
        void this.enqueueRegistration(lifecycle);
      }),
    ];

    const pendingHint = this.nativeGateway.consumePendingProfileChangeHint();
    if (pendingHint) this.emitProfileChanged(pendingHint);

    await this.enqueueRegistration(lifecycle);
  }

  async disconnect(): Promise<void> {
    ++this.lifecycle;
    const client = this.registrationClient;
    this.subscriptions.forEach((subscription) => subscription.remove());
    this.subscriptions = [];
    this.setConnected(false);

    await this.registrationQueue.catch(() => {});
    const deviceId = this.registrationDeviceId;
    this.registrationClient = null;
    this.registrationDeviceId = null;
    if (!client || !deviceId) return;

    try {
      await client.unregisterPushDevice(deviceId);
      console.debug('[PushEventSource] Removed push registration for inactive server');
    } catch (error) {
      console.warn('[PushEventSource] Failed to remove push registration:', errorDiagnostic(error));
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  onProfileChanged(callback: (hint: RemoteProfileChangeHint) => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  onConnectionStateChanged(
    callback: (state: RemoteEventSourceConnectionState) => void
  ): () => void {
    this.stateCallbacks.add(callback);
    return () => this.stateCallbacks.delete(callback);
  }

  private enqueueRegistration(lifecycle: number): Promise<void> {
    const registration = this.registrationQueue
      .catch(() => {})
      .then(() => this.registerLatestToken(lifecycle));
    this.registrationQueue = registration;
    return registration;
  }

  private async registerLatestToken(lifecycle: number): Promise<void> {
    try {
      if (lifecycle !== this.lifecycle || !this.registrationClient) return;
      const token = await this.nativeGateway.getToken();
      if (lifecycle !== this.lifecycle || !this.registrationClient) return;
      if (!token) {
        console.debug('[PushEventSource] FCM token unavailable; push remains disabled');
        return;
      }

      const capabilities = await this.registrationClient.getRealtimeCapabilities();
      if (lifecycle !== this.lifecycle || !this.registrationClient) return;
      if (!capabilities?.push.fcm) {
        console.debug('[PushEventSource] Server does not advertise FCM push support');
        return;
      }

      const deviceId = await this.getDeviceId();
      if (lifecycle !== this.lifecycle || !this.registrationClient) return;
      this.registrationDeviceId = deviceId;
      await this.registrationClient.registerPushDevice(deviceId, {
        platform: 'android',
        provider: 'fcm',
        token,
        appVersion: APP_VERSION,
      });
      if (lifecycle !== this.lifecycle) return;

      this.setConnected(true);
      console.debug('[PushEventSource] FCM push registration active');
    } catch (error) {
      if (lifecycle !== this.lifecycle) return;
      this.setConnected(false);
      console.warn(
        '[PushEventSource] Push registration failed; SignalR fallback remains active:',
        errorDiagnostic(error)
      );
    }
  }

  private emitProfileChanged(hint: NativePushProfileChangeHint): void {
    const remoteHint = { hash: hint.hash || null };
    this.callbacks.forEach((callback) => {
      try {
        callback(remoteHint);
      } catch (error) {
        console.error('[PushEventSource] Profile hint callback failed:', error);
      }
    });
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    const state: RemoteEventSourceConnectionState = connected ? 'CONNECTED' : 'DISCONNECTED';
    this.stateCallbacks.forEach((callback) => {
      try {
        callback(state);
      } catch (error) {
        console.error('[PushEventSource] Connection state callback failed:', error);
      }
    });
  }
}
