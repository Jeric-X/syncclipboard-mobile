import { selectBackgroundRemoteTransportPolicy } from '../services/sync/RemoteTransportPolicy';

describe('background remote transport policy', () => {
  it('disconnects every transport when background remote sync is disabled', () => {
    expect(
      selectBackgroundRemoteTransportPolicy({
        backgroundRemoteSyncEnabled: false,
        pushRegistrationActive: true,
        historyRealtimeRequired: false,
      })
    ).toBe('disconnect-all');
  });

  it('uses push-only mode after push registration succeeds', () => {
    expect(
      selectBackgroundRemoteTransportPolicy({
        backgroundRemoteSyncEnabled: true,
        pushRegistrationActive: true,
        historyRealtimeRequired: false,
      })
    ).toBe('push-only');
  });

  it('preserves the existing SignalR fallback when push is unavailable', () => {
    expect(
      selectBackgroundRemoteTransportPolicy({
        backgroundRemoteSyncEnabled: true,
        pushRegistrationActive: false,
        historyRealtimeRequired: false,
      })
    ).toBe('preserve-existing');
  });

  it('preserves SignalR because V1 push does not carry history events', () => {
    expect(
      selectBackgroundRemoteTransportPolicy({
        backgroundRemoteSyncEnabled: true,
        pushRegistrationActive: true,
        historyRealtimeRequired: true,
      })
    ).toBe('preserve-existing');
  });
});
