export type BackgroundRemoteTransportPolicy = 'disconnect-all' | 'push-only' | 'preserve-existing';

/**
 * Selects the background remote transport without assuming that FCM exists.
 * Push is eligible only after native setup, capability discovery, token acquisition,
 * and server registration have all succeeded. V1 push has no history hints, so history
 * realtime keeps the shared SignalR transport.
 */
export function selectBackgroundRemoteTransportPolicy(input: {
  backgroundRemoteSyncEnabled: boolean;
  pushRegistrationActive: boolean;
  historyRealtimeRequired: boolean;
}): BackgroundRemoteTransportPolicy {
  if (!input.backgroundRemoteSyncEnabled) return 'disconnect-all';
  if (input.historyRealtimeRequired) return 'preserve-existing';
  if (input.pushRegistrationActive) return 'push-only';
  return 'preserve-existing';
}
