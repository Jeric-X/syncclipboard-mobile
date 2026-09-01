import { selectBackgroundRemoteTransportPolicy } from '../services/sync/RemoteTransportPolicy';

describe('background remote transport policy', () => {
  it('disconnects every transport when background remote sync is disabled', () => {
    expect(
      selectBackgroundRemoteTransportPolicy({
        backgroundRemoteSyncEnabled: false,
        pushRegistrationActive: true,
      })
    ).toBe('disconnect-all');
  });

  it('uses push-only mode after push registration succeeds', () => {
    expect(
      selectBackgroundRemoteTransportPolicy({
        backgroundRemoteSyncEnabled: true,
        pushRegistrationActive: true,
      })
    ).toBe('push-only');
  });

  it('preserves the existing SignalR fallback when push is unavailable', () => {
    expect(
      selectBackgroundRemoteTransportPolicy({
        backgroundRemoteSyncEnabled: true,
        pushRegistrationActive: false,
      })
    ).toBe('preserve-existing');
  });
});
