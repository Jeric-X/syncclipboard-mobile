import { selectForegroundServicePolicy } from '../longRunningTask/ForegroundServicePolicy';

describe('foreground service policy', () => {
  const enabledConfig = {
    backgroundTasksEnabled: true,
    backgroundTransferEnabled: true,
    foregroundNotificationEnabled: true,
    temporarilyDisabled: false,
    pushRegistrationActive: false,
    activeTransfer: false,
  };

  it('preserves the existing foreground service fallback without push', () => {
    expect(selectForegroundServicePolicy(enabledConfig)).toEqual({
      shouldRun: true,
      reason: 'signalr-fallback',
    });
  });

  it('stops the persistent foreground service when push is active and idle', () => {
    expect(
      selectForegroundServicePolicy({
        ...enabledConfig,
        pushRegistrationActive: true,
      })
    ).toEqual({ shouldRun: false, reason: 'push-idle' });
  });

  it('keeps the foreground service available for an active transfer in push mode', () => {
    expect(
      selectForegroundServicePolicy({
        ...enabledConfig,
        pushRegistrationActive: true,
        activeTransfer: true,
      })
    ).toEqual({ shouldRun: true, reason: 'active-transfer' });
  });

  it('honors user and runtime disable switches even during a transfer', () => {
    expect(
      selectForegroundServicePolicy({
        ...enabledConfig,
        activeTransfer: true,
        foregroundNotificationEnabled: false,
      })
    ).toEqual({ shouldRun: false, reason: 'disabled-by-settings' });
    expect(
      selectForegroundServicePolicy({
        ...enabledConfig,
        activeTransfer: true,
        temporarilyDisabled: true,
      })
    ).toEqual({ shouldRun: false, reason: 'disabled-by-settings' });
  });
});
