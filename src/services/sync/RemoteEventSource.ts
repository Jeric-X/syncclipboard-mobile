/** A transport-level hint that authoritative remote profile state may have changed. */
export interface RemoteProfileChangeHint {
  hash: string | null;
}

export type RemoteEventSourceConnectionState =
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'RECONNECTING';

/**
 * Low-latency change notification transport.
 * Implementations must not be treated as the authoritative clipboard state.
 */
export interface RemoteEventSource {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  onProfileChanged(callback: (hint: RemoteProfileChangeHint) => void): () => void;
  onConnectionStateChanged?(
    callback: (state: RemoteEventSourceConnectionState) => void
  ): () => void;
}
