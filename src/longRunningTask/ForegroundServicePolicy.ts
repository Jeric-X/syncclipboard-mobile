export interface ForegroundServicePolicyInput {
  backgroundTasksEnabled: boolean;
  backgroundTransferEnabled: boolean;
  foregroundNotificationEnabled: boolean;
  temporarilyDisabled: boolean;
  pushRegistrationActive: boolean;
  activeTransfer: boolean;
}

export type ForegroundServicePolicyReason =
  | 'disabled-by-settings'
  | 'push-idle'
  | 'active-transfer'
  | 'signalr-fallback';

export interface ForegroundServicePolicyDecision {
  shouldRun: boolean;
  reason: ForegroundServicePolicyReason;
}

/**
 * Push 已承担后台远端变更提示时，不再用 dataSync FGS 维持空闲进程。
 * 无 Push 的旧服务器继续沿用原行为，实际传输期间也仍允许使用 FGS。
 */
export function selectForegroundServicePolicy(
  input: ForegroundServicePolicyInput
): ForegroundServicePolicyDecision {
  if (
    input.temporarilyDisabled ||
    !input.backgroundTasksEnabled ||
    !input.backgroundTransferEnabled ||
    !input.foregroundNotificationEnabled
  ) {
    return { shouldRun: false, reason: 'disabled-by-settings' };
  }

  if (input.pushRegistrationActive) {
    return input.activeTransfer
      ? { shouldRun: true, reason: 'active-transfer' }
      : { shouldRun: false, reason: 'push-idle' };
  }
  return { shouldRun: true, reason: 'signalr-fallback' };
}
