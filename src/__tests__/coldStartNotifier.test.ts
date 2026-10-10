import { createColdStartNotifier } from '../utils/coldStartNotifier';

const enabledConfig = { debugMode: true, debugColdStartToast: true, language: 'zh' };

describe('冷启动调试提示', () => {
  it('并发及后续入口调用只读取一次配置并提示一次', async () => {
    let resolveConfig!: (value: typeof enabledConfig) => void;
    const loadConfig = jest.fn(
      () =>
        new Promise<typeof enabledConfig>((resolve) => {
          resolveConfig = resolve;
        })
    );
    const showToast = jest.fn();
    const notify = createColdStartNotifier({ platform: 'android', loadConfig, showToast });

    const first = notify();
    const second = notify();
    expect(first).toBe(second);
    expect(showToast).not.toHaveBeenCalled();
    resolveConfig(enabledConfig);
    await Promise.all([first, second]);
    await notify();

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(enabledConfig);
  });

  it.each([
    { debugMode: false, debugColdStartToast: true },
    { debugMode: true, debugColdStartToast: false },
  ])('开关关闭时不提示，运行期间开启也不补发：%o', async (flags) => {
    const loadConfig = jest.fn().mockResolvedValue({ ...enabledConfig, ...flags });
    const showToast = jest.fn();
    const notify = createColdStartNotifier({ platform: 'android', loadConfig, showToast });

    await notify();
    loadConfig.mockResolvedValue(enabledConfig);
    await notify();

    expect(showToast).not.toHaveBeenCalled();
    expect(loadConfig).toHaveBeenCalledTimes(1);
  });

  it('新的运行时再次提示', async () => {
    const deps = {
      platform: 'android',
      loadConfig: jest.fn().mockResolvedValue(enabledConfig),
      showToast: jest.fn(),
    };
    await createColdStartNotifier(deps)();
    await createColdStartNotifier(deps)();
    expect(deps.showToast).toHaveBeenCalledTimes(2);
  });

  it('iOS 不读取配置或调用 Android Toast', async () => {
    const loadConfig = jest.fn();
    const showToast = jest.fn();
    await createColdStartNotifier({ platform: 'ios', loadConfig, showToast })();
    expect(loadConfig).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('配置读取失败时返回异常供入口记录，不显示提示', async () => {
    const error = new Error('storage unavailable');
    const showToast = jest.fn();
    const notify = createColdStartNotifier({
      platform: 'android',
      loadConfig: jest.fn().mockRejectedValue(error),
      showToast,
    });
    await expect(notify()).rejects.toBe(error);
    expect(showToast).not.toHaveBeenCalled();
  });
});
