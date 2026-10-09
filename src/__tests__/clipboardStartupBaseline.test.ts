import { ClipboardStartupBaseline } from '../utils/clipboardStartupBaseline';

describe('Headless cold-start clipboard baselines', () => {
  it('consumes the first local and remote observations independently', () => {
    const baseline = new ClipboardStartupBaseline();
    baseline.initialize(true);
    expect(baseline.consume('remote', null)).toBe(true);
    expect(baseline.consume('local', null)).toBe(true);
    expect(baseline.consume('remote', null)).toBe(false);
    expect(baseline.consume('local', null)).toBe(false);
  });

  it('does not suppress changes when the runtime is first started by a UI', () => {
    const baseline = new ClipboardStartupBaseline();
    baseline.initialize(false);
    baseline.initialize(true);
    expect(baseline.consume('local', null)).toBe(false);
    expect(baseline.consume('remote', null)).toBe(false);
  });

  it('does not reset consumed baselines when the UI or service re-enters the same runtime', () => {
    const baseline = new ClipboardStartupBaseline();
    baseline.initialize(true);
    expect(baseline.consume('local', null)).toBe(true);
    baseline.initialize(false);
    baseline.initialize(true);
    expect(baseline.consume('local', null)).toBe(false);
    expect(baseline.consume('remote', null)).toBe(true);
  });

  it('preserves the next real change if a manual operation already established the baseline', () => {
    const baseline = new ClipboardStartupBaseline();
    baseline.initialize(true);
    expect(baseline.consume('local', 'copied-from-remote')).toBe(false);
    expect(baseline.consume('local', null)).toBe(false);
  });
});
