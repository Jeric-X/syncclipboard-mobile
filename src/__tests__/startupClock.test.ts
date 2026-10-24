import { createStartupClock } from '../utils/startupClock';

describe('启动计时器', () => {
  it('系统已运行很久时，仍从本次启动的零点计时', () => {
    let now = 2_728_733_964;
    const elapsed = createStartupClock(() => now);

    expect(elapsed()).toBe(0);
    now += 1_999;
    expect(elapsed()).toBe(1_999);
    now += 1;
    expect(elapsed()).toBe(2_000);
  });

  it('重复读取不会重置启动起点', () => {
    let now = 100_000;
    const elapsed = createStartupClock(() => now);
    now += 3_000;
    expect(elapsed()).toBe(3_000);
    now += 60_000;
    expect(elapsed()).toBe(63_000);
  });

  it('新的运行时有独立起点', () => {
    let now = 100_000;
    const first = createStartupClock(() => now);
    now += 60_000;
    const second = createStartupClock(() => now);
    now += 500;

    expect(first()).toBe(60_500);
    expect(second()).toBe(500);
  });
});
