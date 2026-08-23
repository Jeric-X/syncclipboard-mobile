import { UpdateService, type UpdateServiceDependencies } from '@/services/update';
import { DEFAULT_APP_CONFIG } from '@/types/storage';
import type { UpdateCheckResult } from '@/utils/update';

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0' }));

const updateResult: UpdateCheckResult = {
  hasUpdate: true,
  latestVersion: '9.9.9',
  tagName: 'v9.9.9',
  releaseUrl: 'https://example.com/release',
  giteeReleaseUrl: 'https://example.com/gitee-release',
  assets: [
    {
      name: 'SyncClipboard-9.9.9-universal.apk',
      githubDownloadUrl: 'https://example.com/github.apk',
      giteeDownloadUrl: 'https://example.com/gitee.apk',
    },
  ],
  releaseNotes: 'notes',
};

function createDependencies(
  overrides: Partial<UpdateServiceDependencies> = {}
): UpdateServiceDependencies {
  return {
    getConfig: jest.fn(async () => ({ ...DEFAULT_APP_CONFIG })),
    setLastCheckDate: jest.fn(async () => {}),
    check: jest.fn(async () => updateResult),
    cleanCache: jest.fn(),
    getSupportedAbis: jest.fn(() => ['arm64-v8a']),
    checkCache: jest.fn(async () => null),
    download: jest.fn(async () => 'file:///update.apk'),
    install: jest.fn(async () => {}),
    getToday: jest.fn(() => '2026-08-23'),
    isAndroid: jest.fn(() => true),
    ...overrides,
  };
}

describe('UpdateService', () => {
  it('当天已经自动检查时不重复请求', async () => {
    const dependencies = createDependencies({
      getConfig: jest.fn(async () => ({
        ...DEFAULT_APP_CONFIG,
        lastUpdateCheckDate: '2026-08-23',
      })),
    });
    const service = new UpdateService(dependencies);

    await expect(service.checkAutomatically()).resolves.toBeNull();
    expect(dependencies.check).not.toHaveBeenCalled();
  });

  it('首页自动检查后发布可更新状态', async () => {
    const dependencies = createDependencies();
    const service = new UpdateService(dependencies);

    await expect(service.checkAutomatically()).resolves.toEqual(updateResult);
    expect(dependencies.setLastCheckDate).toHaveBeenCalledWith('2026-08-23');
    expect(service.getState()).toMatchObject({
      isChecking: false,
      updateAvailable: true,
      latestVersion: '9.9.9',
      assets: updateResult.assets,
      releaseNotes: 'notes',
    });
  });

  it('iOS 自动检查静默跳过且不会进入 APK 下载流程', async () => {
    const dependencies = createDependencies({ isAndroid: jest.fn(() => false) });
    const service = new UpdateService(dependencies);

    await expect(service.checkAutomatically()).resolves.toBeNull();
    expect(dependencies.check).not.toHaveBeenCalled();
    await expect(
      service.downloadAndInstall('github', updateResult.latestVersion, updateResult.assets)
    ).rejects.toThrow();
    expect(dependencies.download).not.toHaveBeenCalled();
    expect(dependencies.install).not.toHaveBeenCalled();
  });

  it('下载时持续发布进度并在完成后调用安装器', async () => {
    const dependencies = createDependencies({
      download: jest.fn(async (options) => {
        options.onProgress?.({ progress: 0.42, bytesReceived: 42, totalBytes: 100 });
        return 'file:///update.apk';
      }),
    });
    const service = new UpdateService(dependencies);
    const progressValues: number[] = [];
    service.subscribe((state) => progressValues.push(state.downloadProgress));

    await service.downloadAndInstall('github', updateResult.latestVersion, updateResult.assets);

    expect(progressValues).toContain(0.42);
    expect(dependencies.install).toHaveBeenCalledWith('file:///update.apk');
    expect(service.getState()).toMatchObject({ isDownloading: false, downloadProgress: 0 });
  });

  it('取消尚未退出的下载时保持互斥，阻止立即重试覆盖同一缓存文件', async () => {
    const dependencies = createDependencies({
      download: jest.fn(
        (options) =>
          new Promise<string>((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          })
      ),
    });
    const service = new UpdateService(dependencies);
    const firstDownload = service.downloadAndInstall(
      'github',
      updateResult.latestVersion,
      updateResult.assets
    );
    await Promise.resolve();
    await Promise.resolve();

    service.cancelDownload();
    const retry = service.downloadAndInstall(
      'github',
      updateResult.latestVersion,
      updateResult.assets
    );

    expect(service.getState().isDownloading).toBe(true);
    expect(dependencies.download).toHaveBeenCalledTimes(1);
    await expect(retry).resolves.toBeUndefined();
    await expect(firstDownload).rejects.toMatchObject({ name: 'AbortError' });
    expect(service.getState().isDownloading).toBe(false);
  });

  it('安装器启动失败时保留可重试的更新状态', async () => {
    const dependencies = createDependencies({
      install: jest.fn(async () => {
        throw new Error('installer unavailable');
      }),
    });
    const service = new UpdateService(dependencies);
    await service.checkForUpdates();

    await expect(
      service.downloadAndInstall('github', updateResult.latestVersion, updateResult.assets)
    ).rejects.toThrow('installer unavailable');
    expect(service.getState()).toMatchObject({
      updateAvailable: true,
      latestVersion: updateResult.latestVersion,
      assets: updateResult.assets,
    });
  });
});
