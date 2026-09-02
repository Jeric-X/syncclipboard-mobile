/**
 * ForegroundServiceTask
 * 持续任务：管理 Android 前台常驻通知服务。
 *
 * 职责：
 * - 根据后台任务总开关（enableBackgroundTasks + enableBackgroundDownload/Upload +
 *   enableForegroundNotification + tempDisabled）决定是否运行前台服务
 * - 监听通知栏"停止"／"临时停止"操作并写回配置或运行时状态
 * - 通过 onConfigChanged 响应配置变更（由 LongRunningTaskManager 统一分发）
 * - 自行订阅 backgroundRuntimeState，运行时状态变更时动态响应
 *
 * 注意：仅在 Android 上生效，iOS 直接 no-op。
 * 生命周期由 LongRunningTaskManager 统一管理。
 */

import { Platform } from 'react-native';
import * as ForegroundService from 'foreground-service';
import { LongRunningTask } from './LongRunningTask';
import { configService } from '../services/ConfigService';
import { backgroundRuntimeState } from '../services/BackgroundRuntimeState';
import { remoteClipboardMonitor } from '../services/sync/RemoteClipboardMonitor';
import { clipboardSyncState } from '../services/sync/SyncState';
import {
  getHistoryTransferQueue,
  type HistoryTransferQueue,
  type TransferTask,
} from '../services/history/HistoryTransferQueue';
import { updateService } from '../services/update/UpdateService';
import {
  selectForegroundServicePolicy,
  type ForegroundServicePolicyDecision,
  type ForegroundServicePolicyReason,
} from './ForegroundServicePolicy';

class ForegroundServiceTask extends LongRunningTask {
  readonly name = 'foregroundService';

  /** 任务是否已启动（订阅是否活跃） */
  private _running = false;
  /** ForegroundService 当前是否正在运行 */
  private _serviceActive = false;

  private _runtimeUnsub: (() => void) | null = null;
  private _pushStateUnsub: (() => void) | null = null;
  private _clipboardStateUnsub: (() => void) | null = null;
  private _updateStateUnsub: (() => void) | null = null;
  private _historyTransferQueue: HistoryTransferQueue | null = null;
  private readonly _activeHistoryTransfers = new Set<string>();
  private _clipboardTransferActive = false;
  private _updateTransferActive = false;
  private _lastPolicyReason: ForegroundServicePolicyReason | null = null;
  private _stopSub: { remove(): void } | null = null;
  private _tempStopSub: { remove(): void } | null = null;

  async start(): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (this._running) return;
    this._running = true;

    // 清除可能残留的复活通知（用户未通过复活通知而是直接打开 APP 时，通知不会自动消失）
    ForegroundService.cancelRestartNotification();

    // 订阅运行时状态变更
    this._runtimeUnsub = backgroundRuntimeState.subscribe(() => {
      this._requestRefresh('runtime state change');
    });
    this._attachPowerPolicyListeners();

    // 立即应用当前配置和 Push/传输状态
    await this._refresh();
  }

  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;

    this._runtimeUnsub?.();
    this._runtimeUnsub = null;
    this._detachPowerPolicyListeners();
    this._lastPolicyReason = null;

    await this._stopService();
  }

  isRunning(): boolean {
    return this._running;
  }

  override async onConfigChanged(): Promise<void> {
    await this._refresh();
  }

  // ─── 私有实现 ─────────────────────────────────────────────

  private async _selectForegroundServicePolicy(): Promise<ForegroundServicePolicyDecision> {
    const config = await configService.getConfig();
    return selectForegroundServicePolicy({
      temporarilyDisabled: backgroundRuntimeState.isTempDisabled(),
      backgroundTasksEnabled: !!config?.enableBackgroundTasks,
      backgroundTransferEnabled: !!(
        config?.enableBackgroundDownload || config?.enableBackgroundUpload
      ),
      foregroundNotificationEnabled: !!config?.enableForegroundNotification,
      pushRegistrationActive: remoteClipboardMonitor.isPushConnected(),
      activeTransfer: this._hasActiveTransfer(),
    });
  }

  /** 根据当前配置决定启动或停止服务 */
  private async _refresh(): Promise<void> {
    const decision = await this._selectForegroundServicePolicy();
    if (decision.reason !== this._lastPolicyReason) {
      this._lastPolicyReason = decision.reason;
      console.log(
        `[ForegroundServiceTask] Power policy changed: ${decision.reason}; service=${
          decision.shouldRun ? 'required' : 'idle'
        }`
      );
    }

    if (decision.shouldRun) {
      await this._startService();
    } else {
      await this._stopService();
    }
  }

  /** 启动前台服务 */
  private async _startService(): Promise<void> {
    if (this._serviceActive) return;
    this._serviceActive = true;

    try {
      ForegroundService.startService();
      this._attachServiceListeners();
    } catch (e) {
      console.error('[ForegroundServiceTask] Failed to start foreground service:', e);
    }

    console.log('[ForegroundServiceTask] Foreground service started');
  }

  /** 停止前台服务 */
  private async _stopService(): Promise<void> {
    if (!this._serviceActive) return;
    this._serviceActive = false;

    this._detachServiceListeners();

    try {
      ForegroundService.stopService();
    } catch {}
    console.log('[ForegroundServiceTask] Foreground service stopped');
  }

  private _attachPowerPolicyListeners(): void {
    this._pushStateUnsub = remoteClipboardMonitor.addPushRegistrationStateListener(() => {
      this._requestRefresh('push registration state change');
    });

    const initialSyncState = clipboardSyncState.getState();
    this._clipboardTransferActive =
      initialSyncState.uploadingClipboard || initialSyncState.downloadingRemote;
    this._clipboardStateUnsub = clipboardSyncState.subscribe((state) => {
      const active = state.uploadingClipboard || state.downloadingRemote;
      if (active === this._clipboardTransferActive) return;
      this._clipboardTransferActive = active;
      this._requestRefresh('clipboard transfer state change');
    });

    this._updateTransferActive = updateService.getState().isDownloading;
    this._updateStateUnsub = updateService.subscribe((state) => {
      if (state.isDownloading === this._updateTransferActive) return;
      this._updateTransferActive = state.isDownloading;
      this._requestRefresh('update transfer state change');
    });

    const queue = getHistoryTransferQueue();
    this._historyTransferQueue = queue;
    queue.getActiveTasks().forEach((task) => this._updateHistoryTransfer(task));
    queue.onTaskStatusChanged(this._handleHistoryTransferStateChanged);
  }

  private _detachPowerPolicyListeners(): void {
    this._pushStateUnsub?.();
    this._pushStateUnsub = null;
    this._clipboardStateUnsub?.();
    this._clipboardStateUnsub = null;
    this._updateStateUnsub?.();
    this._updateStateUnsub = null;
    this._historyTransferQueue?.offTaskStatusChanged(this._handleHistoryTransferStateChanged);
    this._historyTransferQueue = null;
    this._activeHistoryTransfers.clear();
    this._clipboardTransferActive = false;
    this._updateTransferActive = false;
  }

  private readonly _handleHistoryTransferStateChanged = (task: TransferTask): void => {
    const wasActive = this._activeHistoryTransfers.size > 0;
    this._updateHistoryTransfer(task);
    if (wasActive !== this._activeHistoryTransfers.size > 0) {
      this._requestRefresh('history transfer state change');
    }
  };

  private _updateHistoryTransfer(task: TransferTask): void {
    const key = `${task.type}:${task.profileId}`;
    if (task.status === 'running') {
      this._activeHistoryTransfers.add(key);
    } else {
      this._activeHistoryTransfers.delete(key);
    }
  }

  private _hasActiveTransfer(): boolean {
    return (
      this._clipboardTransferActive ||
      this._updateTransferActive ||
      this._activeHistoryTransfers.size > 0
    );
  }

  private _requestRefresh(reason: string): void {
    this._refresh().catch((error) => {
      console.error(`[ForegroundServiceTask] Failed to apply ${reason}:`, error);
    });
  }

  /** 绑定通知栏操作监听 */
  private _attachServiceListeners(): void {
    this._stopSub = ForegroundService.addStopListener(() => {
      configService.updateConfig({ enableBackgroundTasks: false }).catch((e) => {
        console.error('[ForegroundServiceTask] Failed to disable background tasks:', e);
      });
    });
    this._tempStopSub = ForegroundService.addTempStopListener(() => {
      backgroundRuntimeState.setTempDisabled(true);
    });
  }

  /** 移除通知栏操作监听 */
  private _detachServiceListeners(): void {
    this._stopSub?.remove();
    this._tempStopSub?.remove();
    this._stopSub = null;
    this._tempStopSub = null;
  }
}

export const foregroundServiceTask = new ForegroundServiceTask();
