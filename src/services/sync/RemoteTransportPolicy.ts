export type BackgroundRemoteTransportPolicy = 'disconnect-all' | 'push-only' | 'preserve-existing';

/**
 * Selects the background remote transport without assuming that FCM exists.
 * Push is eligible only after native setup, capability discovery, token acquisition,
 * and server registration have all succeeded.
 */
export function selectBackgroundRemoteTransportPolicy(input: {
  backgroundRemoteSyncEnabled: boolean;
  pushRegistrationActive: boolean;
}): BackgroundRemoteTransportPolicy {
  if (!input.backgroundRemoteSyncEnabled) return 'disconnect-all';
  if (input.pushRegistrationActive) return 'push-only';
  return 'preserve-existing';
}
