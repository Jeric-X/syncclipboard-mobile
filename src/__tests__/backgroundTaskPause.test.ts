import { updateBackgroundTaskPause } from '../utils/backgroundTaskPause';

describe('explicit background task resume', () => {
  function setup(initialReason: string | null) {
    let reason = initialReason;
    let reasonWhenNotified: string | null = initialReason;
    const deps = {
      getStopReason: () => reason,
      clearStopReason: jest.fn(() => {
        reason = null;
      }),
      setTempDisabled: jest.fn(() => {
        reasonWhenNotified = reason;
      }),
    };
    return { deps, reasonWhenNotified: () => reasonWhenNotified };
  }

  it('clears native temporary pause before notifying tasks of a manual resume', () => {
    const { deps, reasonWhenNotified } = setup('temporary');
    updateBackgroundTaskPause(false, deps);
    expect(reasonWhenNotified()).toBeNull();
    expect(deps.clearStopReason).toHaveBeenCalledTimes(1);
    expect(deps.setTempDisabled).toHaveBeenCalledWith(false);
  });

  it('preserves a permanent stop for the runtime to persist in configuration', () => {
    const { deps, reasonWhenNotified } = setup('stop');
    updateBackgroundTaskPause(false, deps);
    expect(deps.clearStopReason).not.toHaveBeenCalled();
    expect(reasonWhenNotified()).toBe('stop');
  });

  it('does not clear native state when pausing', () => {
    const { deps } = setup('temporary');
    updateBackgroundTaskPause(true, deps);
    expect(deps.clearStopReason).not.toHaveBeenCalled();
    expect(deps.setTempDisabled).toHaveBeenCalledWith(true);
  });

  it('resumes when no native stop reason exists', () => {
    const { deps } = setup(null);
    updateBackgroundTaskPause(false, deps);
    expect(deps.clearStopReason).not.toHaveBeenCalled();
    expect(deps.setTempDisabled).toHaveBeenCalledWith(false);
  });
});
