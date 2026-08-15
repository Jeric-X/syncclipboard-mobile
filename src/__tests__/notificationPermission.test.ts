import {
  hasNotificationPermission,
  requestNotificationPermission,
  type NotificationPermissionDependencies,
} from '../utils/notificationPermission';

function createDependencies(
  overrides: Partial<NotificationPermissionDependencies> = {}
): NotificationPermissionDependencies {
  return {
    isRuntimePermissionRequired: jest.fn(() => true),
    hasPermission: jest.fn(async () => false),
    requestPermission: jest.fn(async () => true),
    showRequestFailed: jest.fn(),
    ...overrides,
  };
}

describe('requestNotificationPermission', () => {
  it('运行时无需申请权限时检查结果为已授权', async () => {
    const dependencies = createDependencies({
      isRuntimePermissionRequired: jest.fn(() => false),
    });

    await expect(hasNotificationPermission(dependencies)).resolves.toBe(true);
    expect(dependencies.hasPermission).not.toHaveBeenCalled();
  });

  it('运行时无需申请权限时静默成功', async () => {
    const dependencies = createDependencies({
      isRuntimePermissionRequired: jest.fn(() => false),
    });

    await expect(requestNotificationPermission({}, dependencies)).resolves.toBe(true);
    expect(dependencies.hasPermission).not.toHaveBeenCalled();
    expect(dependencies.requestPermission).not.toHaveBeenCalled();
    expect(dependencies.showRequestFailed).not.toHaveBeenCalled();
  });

  it('已有权限时不重复申请', async () => {
    const dependencies = createDependencies({
      hasPermission: jest.fn(async () => true),
    });

    await expect(requestNotificationPermission({}, dependencies)).resolves.toBe(true);
    expect(dependencies.requestPermission).not.toHaveBeenCalled();
    expect(dependencies.showRequestFailed).not.toHaveBeenCalled();
  });

  it('没有权限时向系统申请', async () => {
    const dependencies = createDependencies();

    await expect(requestNotificationPermission({}, dependencies)).resolves.toBe(true);
    expect(dependencies.requestPermission).toHaveBeenCalledTimes(1);
    expect(dependencies.showRequestFailed).not.toHaveBeenCalled();
  });

  it('申请失败时提示用户并返回失败', async () => {
    const dependencies = createDependencies({
      requestPermission: jest.fn(async () => false),
    });

    await expect(requestNotificationPermission({}, dependencies)).resolves.toBe(false);
    expect(dependencies.showRequestFailed).toHaveBeenCalledTimes(1);
  });

  it('系统申请抛出异常时提示用户', async () => {
    const dependencies = createDependencies({
      requestPermission: jest.fn(async () => {
        throw new Error('request failed');
      }),
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(requestNotificationPermission({}, dependencies)).resolves.toBe(false);
    expect(dependencies.showRequestFailed).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('可以由调用方接管失败后的兜底行为', async () => {
    const dependencies = createDependencies({
      requestPermission: jest.fn(async () => false),
    });

    await expect(
      requestNotificationPermission({ showFailureAlert: false }, dependencies)
    ).resolves.toBe(false);
    expect(dependencies.showRequestFailed).not.toHaveBeenCalled();
  });
});
