/**
 * 应用更新服务。
 * 统一管理检查、APK 下载与安装，并通过发布订阅向 UI 暴露进度状态。
 */

import { APP_VERSION } from '@/constants';
import { configService } from '@/services/ConfigService';
import {
  checkApkCache,
  cleanOldApkCache,
  downloadApk,
  findAssetForAbi,
  getPreferredAbi,
  installApk,
  type ApkSource,
} from '@/utils/apkDownload';
import { checkForUpdate, type ReleaseAssetInfo, type UpdateCheckResult } from '@/utils/update';
import i18n from '@/i18n';
import { getSupportedAbis } from 'native-util';
import { Platform } from 'react-native';
import type { AppConfig } from '@/types/storage';

export interface UpdateServiceState {
  isChecking: boolean;
  updateAvailable: boolean;
  latestVersion: string | null;
  assets: ReleaseAssetInfo[];
  releaseNotes?: string;
  isDownloading: boolean;
  downloadProgress: number;
}

type UpdateStateListener = (state: UpdateServiceState) => void;

export interface UpdateServiceDependencies {
  getConfig: () => Promise<AppConfig>;
  setLastCheckDate: (date: string) => Promise<void>;
  check: typeof checkForUpdate;
  cleanCache: typeof cleanOldApkCache;
  getSupportedAbis: typeof getSupportedAbis;
  checkCache: typeof checkApkCache;
  download: typeof downloadApk;
  install: typeof installApk;
  getToday: () => string;
  isAndroid: () => boolean;
}

const initialState: UpdateServiceState = {
  isChecking: false,
  updateAvailable: false,
  latestVersion: null,
  assets: [],
  releaseNotes: undefined,
  isDownloading: false,
  downloadProgress: 0,
};

const defaultDependencies: UpdateServiceDependencies = {
  getConfig: () => configService.getConfig(),
  setLastCheckDate: async (date) => {
    await configService.updateConfig({ lastUpdateCheckDate: date });
  },
  check: checkForUpdate,
  cleanCache: cleanOldApkCache,
  getSupportedAbis,
  checkCache: checkApkCache,
  download: downloadApk,
  install: installApk,
  getToday: () => new Date().toISOString().slice(0, 10),
  isAndroid: () => Platform.OS === 'android',
};

export class UpdateService {
  private state: UpdateServiceState = { ...initialState };
  private readonly listeners = new Set<UpdateStateListener>();
  private checkAbortController: AbortController | null = null;
  private downloadAbortController: AbortController | null = null;
  private autoCheckStarted = false;

  constructor(private readonly dependencies: UpdateServiceDependencies = defaultDependencies) {}

  getState(): UpdateServiceState {
    return this.state;
  }

  subscribe(listener: UpdateStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<UpdateServiceState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }

  /** 首页调用；每个进程生命周期最多尝试一次，并遵循自动检查配置和每日限制。 */
  async checkAutomatically(): Promise<UpdateCheckResult | null> {
    if (this.autoCheckStarted) return null;
    this.autoCheckStarted = true;
    if (!this.dependencies.isAndroid()) return null;

    const config = await this.dependencies.getConfig();
    if (!config.autoCheckUpdate) return null;

    const today = this.dependencies.getToday();
    if (!config.debugUpdateCheckNoLimit && config.lastUpdateCheckDate === today) return null;

    return this.checkForUpdates(config.updateToBeta);
  }

  /** 执行一次更新检查，并将结果写入全局更新状态。 */
  async checkForUpdates(includeBeta?: boolean): Promise<UpdateCheckResult> {
    this.cancelCheck();
    const abortController = new AbortController();
    this.checkAbortController = abortController;
    this.setState({ isChecking: true });

    try {
      const config = await this.dependencies.getConfig();
      await this.dependencies.setLastCheckDate(this.dependencies.getToday());
      const result = await this.dependencies.check(
        APP_VERSION,
        includeBeta ?? config.updateToBeta,
        config.updateChannel,
        abortController.signal
      );
      this.throwIfCancelled(abortController, this.checkAbortController);

      this.setState({
        updateAvailable: result.hasUpdate,
        latestVersion: result.hasUpdate ? result.latestVersion : null,
        assets: result.hasUpdate ? result.assets : [],
        releaseNotes: result.hasUpdate ? result.releaseNotes : undefined,
      });
      this.dependencies.cleanCache(APP_VERSION);
      return result;
    } finally {
      if (this.checkAbortController === abortController) {
        this.checkAbortController = null;
        this.setState({ isChecking: false });
      }
    }
  }

  cancelCheck(): void {
    this.checkAbortController?.abort();
    this.checkAbortController = null;
    this.setState({ isChecking: false });
  }

  /** 若目标版本已有有效缓存则直接安装，返回是否命中缓存。 */
  async installCachedUpdate(version: string, assets: ReleaseAssetInfo[]): Promise<boolean> {
    if (!this.dependencies.isAndroid()) return false;

    const asset = this.selectAsset(assets);
    if (!asset) return false;

    const cached = await this.dependencies.checkCache(version, asset);
    if (!cached) return false;

    await this.dependencies.install(cached);
    return true;
  }

  /** 下载指定版本并调用系统安装器；下载进度会持续发布给设置页。 */
  async downloadAndInstall(
    source: ApkSource,
    version: string,
    assets: ReleaseAssetInfo[]
  ): Promise<void> {
    if (!this.dependencies.isAndroid()) {
      throw new Error(i18n.t('settings.updateNotSupportedMessage'));
    }
    if (this.downloadAbortController) return;

    const asset = this.selectAsset(assets);
    if (!asset) throw new Error(i18n.t('settings.noSuitableApk'));

    const abortController = new AbortController();
    this.downloadAbortController = abortController;
    this.setState({ isDownloading: true, downloadProgress: 0 });

    try {
      const cached = await this.dependencies.checkCache(version, asset);
      this.throwIfCancelled(abortController, this.downloadAbortController);
      const fileUri =
        cached ??
        (await this.dependencies.download({
          asset,
          source,
          version,
          signal: abortController.signal,
          onProgress: (info) => {
            if (this.downloadAbortController === abortController) {
              this.setState({ downloadProgress: info.progress });
            }
          },
        }));
      this.throwIfCancelled(abortController, this.downloadAbortController);

      await this.dependencies.install(fileUri);
      this.setState({
        updateAvailable: false,
        latestVersion: null,
        assets: [],
        releaseNotes: undefined,
      });
    } finally {
      if (this.downloadAbortController === abortController) {
        this.downloadAbortController = null;
        this.setState({ isDownloading: false, downloadProgress: 0 });
      }
    }
  }

  cancelDownload(): void {
    this.downloadAbortController?.abort();
  }

  /** 更新通道切换时取消旧任务并清空旧通道的检查结果。 */
  reset(): void {
    this.cancelCheck();
    this.cancelDownload();
    const isDownloading = this.downloadAbortController !== null;
    this.setState({
      ...initialState,
      isDownloading,
      downloadProgress: isDownloading ? this.state.downloadProgress : 0,
    });
  }

  private selectAsset(assets: ReleaseAssetInfo[]): ReleaseAssetInfo | undefined {
    let preferredAbi: Parameters<typeof findAssetForAbi>[1] = 'universal';
    try {
      preferredAbi = getPreferredAbi(this.dependencies.getSupportedAbis());
    } catch (error) {
      console.warn('[UpdateService] getSupportedAbis failed:', error);
    }
    return findAssetForAbi(assets, preferredAbi);
  }

  private throwIfCancelled(
    controller: AbortController,
    activeController: AbortController | null
  ): void {
    if (controller.signal.aborted || activeController !== controller) {
      throw new DOMException('Aborted', 'AbortError');
    }
  }
}

export const updateService = new UpdateService();
