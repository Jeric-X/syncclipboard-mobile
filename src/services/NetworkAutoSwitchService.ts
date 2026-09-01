import { Platform, ToastAndroid } from 'react-native';
import { showNotification } from 'native-util';
import { clearTimer, setTimer } from 'native-timer';
import i18n from '@/i18n';
import type { AppConfig } from '@/types/storage';
import type {
  MobileNetworkSnapshot,
  NetworkEvaluationResult,
  NetworkSwitchNotificationMode,
} from '@/types/networkAutoSwitch';
import { configService } from './ConfigService';
import { currentNetworkService } from './CurrentNetworkService';
import { getHistorySyncService } from './history/HistorySyncService';
import { evaluateNetworkAutoSwitch, getNetworkFingerprint } from '@/utils/networkAutoSwitch';

export type NetworkAutoSwitchPhase =
  | 'disabled'
  | 'detecting'
  | 'waiting'
  | 'matched'
  | 'no-match'
  | 'manual-override'
  | 'error';

export interface NetworkAutoSwitchState {
  phase: NetworkAutoSwitchPhase;
  snapshot: MobileNetworkSnapshot | null;
  evaluation: NetworkEvaluationResult | null;
  activeServerId: string | null;
  activeServerName: string | null;
  lastEvaluatedAt: number | null;
  error: string | null;
  manualOverride: boolean;
}

export interface NetworkAutoSwitchDependencies {
  getConfig(): Promise<AppConfig>;
  switchServer(serverId: string | null): Promise<AppConfig>;
  getSnapshot(): Promise<MobileNetworkSnapshot>;
  subscribeNetwork(listener: () => void): () => void;
  notify(message: string, mode: Exclude<NetworkSwitchNotificationMode, 'none'>): void;
}

type EvaluationOutcome = 'completed' | 'superseded';

type OneShotSelectionRoute =
  | { kind: 'managed' }
  | { kind: 'cold'; config: AppConfig }
  | { kind: 'skip'; reason: 'disabled' | 'superseded' };

const NETWORK_CHANGE_DEBOUNCE_MS = 1000;

const initialState: NetworkAutoSwitchState = {
  phase: 'disabled',
  snapshot: null,
  evaluation: null,
  activeServerId: null,
  activeServerName: null,
  lastEvaluatedAt: null,
  error: null,
  manualOverride: false,
};

function activeServer(config: AppConfig) {
  return config.servers[config.activeServerIndex] ?? null;
}

function configSignature(config: AppConfig): string {
  return JSON.stringify({
    autoSwitch: config.networkAutoSwitch,
    servers: config.servers.map((server) => ({
      id: server.id,
      name: server.name,
      url: server.url,
    })),
  });
}

function resultPhase(result: NetworkEvaluationResult): NetworkAutoSwitchPhase {
  if (result.reason === 'disabled') return 'disabled';
  if (result.reason === 'waiting-for-network') return 'waiting';
  if (result.reason.startsWith('matched')) return 'matched';
  return 'no-match';
}

function productionNotification(
  message: string,
  mode: Exclude<NetworkSwitchNotificationMode, 'none'>
): void {
  if (Platform.OS !== 'android') return;
  if (mode === 'toast') {
    ToastAndroid.show(message, ToastAndroid.LONG);
    return;
  }
  const title = i18n.t('networkAutoSwitch.notificationTitle');
  showNotification({
    id: 4602,
    channelId: 'network_auto_switch',
    channelName: title,
    title,
    content: message,
    importance: 'low',
    timeoutMs: 30_000,
  });
}

function createProductionDependencies(): NetworkAutoSwitchDependencies {
  return {
    getConfig: () => configService.getConfig(),
    switchServer: async (serverId) => {
      getHistorySyncService().cancelAll();
      return configService.setActiveServerById(serverId);
    },
    getSnapshot: () => currentNetworkService.getSnapshot(),
    subscribeNetwork: (listener) => currentNetworkService.subscribe(listener),
    notify: productionNotification,
  };
}

/**
 * 根据当前默认网络串行评估并切换服务器。
 *
 * 所有异步评估带版本号，旧快照永远不能覆盖更新的网络事件。
 */
export class NetworkAutoSwitchService {
  private readonly deps: NetworkAutoSwitchDependencies;
  private state: NetworkAutoSwitchState = initialState;
  private readonly listeners = new Set<() => void>();
  private running = false;
  private startupPromise: Promise<void> | null = null;
  private networkUnsubscribe: (() => void) | null = null;
  private debounceTimerTag: string | null = null;
  private networkDirty = true;
  private generation = 0;
  private evaluationQueue: Promise<EvaluationOutcome> = Promise.resolve('completed');
  private oneShotSelectionQueue: Promise<void> = Promise.resolve();
  private lastConfigSignature: string | null = null;
  private manualOverrideFingerprint: string | 'pending' | null = null;

  constructor(deps: NetworkAutoSwitchDependencies = createProductionDependencies()) {
    this.deps = deps;
  }

  getState = (): NetworkAutoSwitchState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private updateState(updates: Partial<NetworkAutoSwitchState>): void {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach((listener) => listener());
  }

  async start(): Promise<void> {
    if (this.startupPromise) {
      await this.startupPromise;
      return;
    }
    if (this.running) return;
    this.running = true;
    const startup = this.initialize();
    this.startupPromise = startup;
    try {
      await startup;
    } finally {
      if (this.startupPromise === startup) {
        this.startupPromise = null;
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.networkDirty = true;
    this.generation += 1;
    this.clearDebounce();
    this.networkUnsubscribe?.();
    this.networkUnsubscribe = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  async onConfigChanged(): Promise<void> {
    const config = await this.deps.getConfig();
    const signature = configSignature(config);
    if (signature === this.lastConfigSignature) return;
    this.lastConfigSignature = signature;
    this.manualOverrideFingerprint = null;
    this.syncNetworkSubscription(config.networkAutoSwitch.enabled);
    await this.evaluateNow('config-change');
  }

  async onForeground(): Promise<void> {
    await this.evaluateNow('foreground');
  }

  /** 网络回调经过防抖，短暂断网不会立即执行 no-match。 */
  handleNetworkChanged(): void {
    if (!this.running) return;
    this.networkDirty = true;
    this.generation += 1;
    const generation = this.generation;
    this.clearDebounce();
    const timerTag = `network_auto_switch_debounce_${generation}`;
    this.debounceTimerTag = setTimer(
      () => {
        if (this.debounceTimerTag !== timerTag) return;
        clearTimer(timerTag);
        this.debounceTimerTag = null;
        this.enqueueEvaluation(generation, 'network-change');
      },
      NETWORK_CHANGE_DEBOUNCE_MS,
      timerTag
    );
  }

  /** 用户手动选择前调用，取消尚未完成的自动评估。 */
  beginManualOverride(): void {
    const needsFreshSnapshot = this.networkDirty;
    this.generation += 1;
    this.clearDebounce();
    this.networkDirty = false;
    this.manualOverrideFingerprint =
      !needsFreshSnapshot && this.state.snapshot
        ? getNetworkFingerprint(this.state.snapshot)
        : 'pending';
    this.updateState({ phase: 'manual-override', manualOverride: true, error: null });
  }

  async clearManualOverride(): Promise<void> {
    this.manualOverrideFingerprint = null;
    this.updateState({ manualOverride: false });
    await this.evaluateNow('restore-auto');
  }

  /** 设置页主动重新检测；开启自动切换时同时应用评估结果。 */
  async refresh(): Promise<void> {
    if (!this.running) {
      await this.start();
      return;
    }
    await this.evaluateNow('manual-refresh');
  }

  /** 快捷操作和后台同步访问服务器前调用。 */
  async ensureCurrentServer(): Promise<void> {
    while (true) {
      if (this.startupPromise) {
        await this.startupPromise;
      }
      if (!this.running) {
        await this.start();
      }
      const config = await this.deps.getConfig();
      if (!config.networkAutoSwitch.enabled) return;

      if (this.state.phase === 'detecting') {
        await this.evaluationQueue;
      }

      if (this.hasCurrentEvaluation()) return;
      const outcome = await this.evaluateNow('sync-preflight');
      if (outcome === 'completed') return;
    }
  }

  /**
   * 按当前网络执行一次服务器选择，不启动常驻服务或注册网络监听。
   *
   * 供 Headless 等一次性任务使用。读取网络或切换服务器失败时直接抛出，
   * 由调用方决定是否重试，不回退到选择前的服务器。
   */
  async selectServerForCurrentNetworkOnce(): Promise<void> {
    const selection = this.oneShotSelectionQueue
      .catch(() => {})
      .then(() => this.performOneShotSelection());
    this.oneShotSelectionQueue = selection;
    await selection;
  }

  private async performOneShotSelection(): Promise<void> {
    const selectionGeneration = this.generation;
    let route = await this.resolveOneShotSelectionRoute(selectionGeneration);
    if (route.kind !== 'cold') return this.finishNonColdOneShotSelection(route);

    const snapshot = await this.deps.getSnapshot();
    route = await this.resolveOneShotSelectionRoute(selectionGeneration);
    if (route.kind !== 'cold') return this.finishNonColdOneShotSelection(route);

    await this.applyColdOneShotSelection(route.config, snapshot);
  }

  private async resolveOneShotSelectionRoute(
    selectionGeneration: number
  ): Promise<OneShotSelectionRoute> {
    if (this.hasManagedRuntime()) return { kind: 'managed' };

    const config = await this.deps.getConfig();
    if (this.hasManagedRuntime()) return { kind: 'managed' };
    if (!config.networkAutoSwitch.enabled) {
      return { kind: 'skip', reason: 'disabled' };
    }
    if (selectionGeneration !== this.generation || this.manualOverrideFingerprint !== null) {
      return { kind: 'skip', reason: 'superseded' };
    }
    return { kind: 'cold', config };
  }

  private async finishNonColdOneShotSelection(
    route: Exclude<OneShotSelectionRoute, { kind: 'cold' }>
  ): Promise<void> {
    if (route.kind === 'managed') {
      await this.performManagedOneShotSelection();
      return;
    }
    console.log(`[NetworkAutoSwitch] trigger=one-shot result=${route.reason} target=none-or-keep`);
  }

  private async applyColdOneShotSelection(
    config: AppConfig,
    snapshot: MobileNetworkSnapshot
  ): Promise<void> {
    const evaluation = evaluateNetworkAutoSwitch(
      config.networkAutoSwitch,
      config.servers,
      snapshot
    );
    if (evaluation.reason === 'waiting-for-network') {
      throw new Error('Network unavailable during server selection');
    }
    const before = activeServer(config);
    const targetChanged =
      evaluation.targetServerId !== undefined && evaluation.targetServerId !== (before?.id ?? null);

    let resultingConfig = config;
    if (targetChanged) {
      resultingConfig = await this.deps.switchServer(evaluation.targetServerId ?? null);
      if (config.networkAutoSwitch.notificationMode !== 'none') {
        this.deps.notify(
          this.notificationMessage(evaluation, resultingConfig),
          config.networkAutoSwitch.notificationMode
        );
      }
    }

    console.log(
      `[NetworkAutoSwitch] trigger=one-shot result=${evaluation.reason} target=${
        evaluation.targetServerId ?? 'none-or-keep'
      }`
    );
  }

  private async performManagedOneShotSelection(): Promise<void> {
    await this.ensureCurrentServer();
    const config = await this.deps.getConfig();
    if (!config.networkAutoSwitch.enabled) return;
    if (this.state.phase === 'waiting') {
      throw new Error('Network unavailable during server selection');
    }
    if (this.state.phase === 'error') {
      throw new Error(this.state.error || 'Server selection failed');
    }
  }

  private hasManagedRuntime(): boolean {
    return this.startupPromise !== null || this.running;
  }

  private hasCurrentEvaluation(): boolean {
    const currentPhase =
      this.state.phase === 'waiting' ||
      this.state.phase === 'matched' ||
      this.state.phase === 'no-match' ||
      this.state.phase === 'manual-override';
    return (
      !this.networkDirty &&
      this.debounceTimerTag === null &&
      this.state.snapshot !== null &&
      currentPhase
    );
  }

  private async initialize(): Promise<void> {
    try {
      const config = await this.deps.getConfig();
      this.lastConfigSignature = configSignature(config);
      this.syncNetworkSubscription(config.networkAutoSwitch.enabled);
      await this.evaluateNow('startup');
    } catch (error) {
      this.running = false;
      this.networkUnsubscribe?.();
      this.networkUnsubscribe = null;
      throw error;
    }
  }

  private syncNetworkSubscription(enabled: boolean): void {
    if (!this.running) return;
    if (enabled && !this.networkUnsubscribe) {
      this.networkUnsubscribe = this.deps.subscribeNetwork(() => this.handleNetworkChanged());
    } else if (!enabled && this.networkUnsubscribe) {
      this.networkUnsubscribe();
      this.networkUnsubscribe = null;
      this.clearDebounce();
    }
  }

  private clearDebounce(): void {
    if (this.debounceTimerTag) clearTimer(this.debounceTimerTag);
    this.debounceTimerTag = null;
  }

  private evaluateNow(reason: string): Promise<EvaluationOutcome> {
    this.generation += 1;
    const generation = this.generation;
    this.clearDebounce();
    return this.enqueueEvaluation(generation, reason);
  }

  private enqueueEvaluation(generation: number, reason: string): Promise<EvaluationOutcome> {
    this.evaluationQueue = this.evaluationQueue
      .catch((): EvaluationOutcome => 'completed')
      .then(() => this.performEvaluation(generation, reason));
    return this.evaluationQueue;
  }

  private async performEvaluation(generation: number, trigger: string): Promise<EvaluationOutcome> {
    if (!this.running || generation !== this.generation) return 'superseded';
    this.updateState({ phase: 'detecting', error: null });
    try {
      const [snapshot, config] = await Promise.all([
        this.deps.getSnapshot(),
        this.deps.getConfig(),
      ]);
      if (!this.running || generation !== this.generation) return 'superseded';

      const currentFingerprint = getNetworkFingerprint(snapshot);
      if (this.manualOverrideFingerprint) {
        if (this.manualOverrideFingerprint === 'pending') {
          this.manualOverrideFingerprint = currentFingerprint;
        }
        if (this.manualOverrideFingerprint === currentFingerprint) {
          const active = activeServer(config);
          this.updateState({
            phase: 'manual-override',
            snapshot,
            activeServerId: active?.id ?? null,
            activeServerName: active?.name || active?.url || null,
            lastEvaluatedAt: Date.now(),
            manualOverride: true,
          });
          this.networkDirty = false;
          return 'completed';
        }
        this.manualOverrideFingerprint = null;
      }

      const evaluation = evaluateNetworkAutoSwitch(
        config.networkAutoSwitch,
        config.servers,
        snapshot
      );
      const before = activeServer(config);
      let resultingConfig = config;
      const targetChanged =
        evaluation.targetServerId !== undefined &&
        evaluation.targetServerId !== (before?.id ?? null);

      if (config.networkAutoSwitch.enabled && targetChanged) {
        resultingConfig = await this.deps.switchServer(evaluation.targetServerId ?? null);
        if (!this.running || generation !== this.generation) return 'superseded';
        if (config.networkAutoSwitch.notificationMode !== 'none') {
          this.deps.notify(
            this.notificationMessage(evaluation, resultingConfig),
            config.networkAutoSwitch.notificationMode
          );
        }
      }

      const active = activeServer(resultingConfig);
      console.log(
        `[NetworkAutoSwitch] trigger=${trigger} result=${evaluation.reason} target=${
          evaluation.targetServerId ?? 'none-or-keep'
        }`
      );
      this.updateState({
        phase: resultPhase(evaluation),
        snapshot,
        evaluation,
        activeServerId: active?.id ?? null,
        activeServerName: active?.name || active?.url || null,
        lastEvaluatedAt: Date.now(),
        error: null,
        manualOverride: false,
      });
      this.networkDirty = false;
      return 'completed';
    } catch (error) {
      if (!this.running || generation !== this.generation) return 'superseded';
      this.networkDirty = true;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[NetworkAutoSwitch] trigger=${trigger} failed:`, error);
      this.updateState({ phase: 'error', error: message, lastEvaluatedAt: Date.now() });
      return 'completed';
    }
  }

  private notificationMessage(
    evaluation: NetworkEvaluationResult,
    resultingConfig: AppConfig
  ): string {
    const active = activeServer(resultingConfig);
    if (!active) return i18n.t('networkAutoSwitch.notificationRemoved');
    const name = active.name || active.url;
    if (evaluation.reason === 'matched-rule') {
      return i18n.t('networkAutoSwitch.notificationRule', {
        rule: evaluation.matchedRuleName,
        server: name,
      });
    }
    return i18n.t('networkAutoSwitch.notificationDefault', { server: name });
  }
}

export const networkAutoSwitchService = new NetworkAutoSwitchService();
