import {
  getSignalRClient,
  type ConnectionState,
  type ProfileChangedEvent,
  type SignalRClient,
} from 'signalr-client';
import type { ServerConfig } from '../../types/api';
import type {
  RemoteEventSource,
  RemoteEventSourceConnectionState,
  RemoteProfileChangeHint,
} from './RemoteEventSource';

/** Adapts the existing SignalR client to a content-free remote change event source. */
export class SignalRRemoteEventSource implements RemoteEventSource {
  constructor(
    private readonly server: ServerConfig,
    private readonly client: SignalRClient = getSignalRClient()
  ) {}

  async connect(): Promise<void> {
    await this.client.connect(this.server);
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  isConnected(): boolean {
    try {
      return this.client.isConnected();
    } catch {
      return false;
    }
  }

  onProfileChanged(callback: (hint: RemoteProfileChangeHint) => void): () => void {
    const signalRCallback = (event: ProfileChangedEvent): void => {
      callback({ hash: event.hash || null });
    };
    this.client.onRemoteClipboardChanged(signalRCallback);
    return () => this.client.offRemoteClipboardChanged(signalRCallback);
  }

  onConnectionStateChanged(
    callback: (state: RemoteEventSourceConnectionState) => void
  ): () => void {
    const signalRCallback = (state: ConnectionState): void => callback(state);
    this.client.onConnectionStateChanged(signalRCallback);
    return () => this.client.offConnectionStateChanged(signalRCallback);
  }
}
