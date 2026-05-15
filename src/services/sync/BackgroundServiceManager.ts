/**
 * BackgroundServiceManager
 * 统一管理所有 JS 侧后台服务的生命周期。
 *
 * 负责管理：
 * - ClipboardSyncService（远程同步、SignalR/轮询、SyncManager、自动上传/下载）
 * - HistoryService（本地历史记录追踪）
 * - 前台服务（常驻通知）
 * - 短信验证码服务
 * - 剪贴板监控（startMonitoring）
 * - 统计心跳
 * - 通知栏停止/临时停止监听
 *
 * 被 ServiceRestartApp、QuickActionApp、App（main）调用。
 * HomeScreen 不负责后台服务的启动与停止。
 */

import { Platform } from 'react-native';
import * as ForegroundService from 'foreground-service';
import { setTimer, clearTimer } from 'native-timer';
import { configService } from '../ConfigService';
import { backgroundRuntimeState } from '../BackgroundRuntimeState';

class BackgroundServiceManager {
  private static instance: BackgroundServiceManager | null = null;

  private running = false;
  private heartbeatTag: string | null = null;
  private stopSub: { remove(): void } | null = null;
  private tempStopSub: { remove(): void } | null = null;
  /** 取消对 configService 的订阅 */
  private configUnsub: (() => void) | null = null;
  /** 取消对 backgroundRuntimeState 的订阅 */
  private runtimeUnsub: (() => void) | null = null;

  private constructor() {}

  static getInstance(): BackgroundServiceManager {
    if (!BackgroundServiceManager.instance) {
      BackgroundServiceManager.instance = new BackgroundServiceManager();
    }
    return BackgroundServiceManager.instance;
  }

  // ─── 工具 ───────────────────────────────────────────────

  private async getShouldRunBackground(): Promise<boolean> {
    const config = await configService.getConfig();
    const tempDisabled = backgroundRuntimeState.isTempDisabled();
    return (
      !tempDisabled &&
      !!config?.enableBackgroundTasks &&
      !!(config?.enableBackgroundDownload || config?.enableBackgroundUpload)
    );
  }

  /**
   * 更新静态短信接收器状态。
   * SMS 转发不受后台任务总开关控制，仅由 enableSmsForwarding 决定。
   */
  private async _updateSmsReceiver(): Promise<void> {
    try {
      const config = await configService.getConfig();
      const { setStaticReceiverEnabled } = require('sms-forwarder');
      setStaticReceiverEnabled(!!config?.enableSmsForwarding);
    } catch (e) {
      console.error('[BackgroundServiceManager] Failed to toggle SMS receiver:', e);
    }
  }

  // ─── 公开 API ─────────────────────────────────────────────

  /**
   * 启动所有服务（幂等）。
   * 由任意 Activity 入口调用。
   * - 始终启动剪贴板监控（前台 UI 需要）
   * - 始终启动 ClipboardSyncService（前台 UI + 后台同步）
   * - 仅在后台任务启用时才启动前台通知和心跳
   * - 始终订阅配置变化以支持动态重启
   */
  async start(): Promise<void> {
    // 确保配置已初始化（configStorage 内部做幂等保护）
    await configService.getConfig();

    // SMS 转发始终独立管理（Android 专属）
    if (Platform.OS === 'android') {
      await this._updateSmsReceiver();
    }

    // 始终启动剪贴板监控（无论是否启用后台任务，UI 需要感知本地剪贴板变化）
    try {
      const { clipboardMonitor } = require('../clipboard/ClipboardMonitor');
      if (!clipboardMonitor.isActive()) {
        await clipboardMonitor.start();
        await clipboardMonitor.triggerCheck();
      }
    } catch (e) {
      console.error('[BackgroundServiceManager] Failed to start clipboard monitoring:', e);
    }

    // 始终启动 HistoryTracker 本地历史追踪（无需服务器配置，始终运行）
    try {
      const { getHistoryTracker } = require('../history/HistoryTracker');
      getHistoryTracker().startTracking();
    } catch (e) {
      console.error('[BackgroundServiceManager] Failed to start local history tracking:', e);
    }

    // 始终启动 ClipboardSyncService（前台 UI + 后台同步）
    await this._startRemoteSync();

    // 后台专用服务（前台通知 + 心跳，Android 专属）
    if (Platform.OS === 'android') {
      if (await this.getShouldRunBackground()) {
        if (!this.running) {
          this.running = true;
          await this._startBackgroundOnlyServices();
        }
      } else {
        await this._stopBackgroundOnlyServices();
      }
    }

    // 始终订阅配置变化（不再因 getShouldRunBackground() 为 false 而跳过）
    this._subscribeToChanges();
  }

  /**
   * 停止后台专用服务（前台通知、心跳）。
   * 注意：ClipboardSyncService 不在此处停止，由 refresh() 统一管理。
   */
  async stop(): Promise<void> {
    await this._stopBackgroundOnlyServices();
  }

  /**
   * 配置变化时重新评估所有服务状态（由内部订阅自动触发）。
   */
  async refresh(): Promise<void> {
    // SMS 转发（Android 专属）
    if (Platform.OS === 'android') {
      await this._updateSmsReceiver();
    }

    // 刷新远程同步服务（处理服务器变更、连接类型切换等）
    await this._startRemoteSync();

    // 后台专用服务（Android 专属）
    if (Platform.OS === 'android') {
      if (await this.getShouldRunBackground()) {
        if (!this.running) {
          this.running = true;
          await this._startBackgroundOnlyServices();
        } else {
          await this._updateBackgroundOnlyServices();
        }
      } else {
        await this._stopBackgroundOnlyServices();
      }
    }
  }

  // ─── 私有实现 ─────────────────────────────────────────────

  /** 启动/刷新 ClipboardSyncService */
  private async _startRemoteSync(): Promise<void> {
    try {
      const { getClipboardSyncService } = require('./ClipboardSyncService');
      await getClipboardSyncService().refresh();
    } catch (e) {
      console.error('[BackgroundServiceManager] Failed to start/refresh remote sync:', e);
    }
  }

  /** 启动后台专用服务（前台通知、心跳、剪贴板监控） */
  private async _startBackgroundOnlyServices(): Promise<void> {
    const config = await configService.getConfig();

    // 1. 按需启动前台常驻通知服务
    if (config?.enableForegroundNotification) {
      try {
        ForegroundService.startService();

        this.stopSub = ForegroundService.addStopListener(() => {
          configService.updateConfig({ enableBackgroundTasks: false }).catch((e) => {
            console.error('[BackgroundServiceManager] Failed to disable background tasks:', e);
          });
        });
        this.tempStopSub = ForegroundService.addTempStopListener(() => {
          backgroundRuntimeState.setTempDisabled(true);
        });
      } catch (e) {
        console.error('[BackgroundServiceManager] Failed to start foreground service:', e);
      }
    }

    // 2. 统计心跳
    try {
      const { useStatisticsStore } = require('../../stores/statisticsStore');
      await useStatisticsStore.getState().recordBackgroundTaskStart();

      this.heartbeatTag = setTimer(() => {
        useStatisticsStore.getState().updateHeartbeat();
      }, 60_000);
    } catch (e) {
      console.error('[BackgroundServiceManager] Failed to start statistics/heartbeat:', e);
    }

    console.log('[BackgroundServiceManager] Background-only services started');
  }

  /** 更新后台专用服务（配置变化时调用） */
  private async _updateBackgroundOnlyServices(): Promise<void> {
    const config = await configService.getConfig();

    try {
      const isRunning = ForegroundService.isRunning();
      if (config?.enableForegroundNotification && !isRunning) {
        ForegroundService.startService();
        this.stopSub = ForegroundService.addStopListener(() => {
          configService.updateConfig({ enableBackgroundTasks: false }).catch((e) => {
            console.error('[BackgroundServiceManager] Failed to disable background tasks:', e);
          });
        });
        this.tempStopSub = ForegroundService.addTempStopListener(() => {
          backgroundRuntimeState.setTempDisabled(true);
        });
      } else if (!config?.enableForegroundNotification && isRunning) {
        this._cleanupListeners();
        ForegroundService.stopService();
      }
    } catch (e) {
      console.error('[BackgroundServiceManager] Failed to update foreground service:', e);
    }
  }

  /** 停止后台专用服务 */
  private async _stopBackgroundOnlyServices(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    this._cleanupListeners();

    if (this.heartbeatTag) {
      try {
        clearTimer(this.heartbeatTag);
      } catch {}
      this.heartbeatTag = null;
    }

    try {
      ForegroundService.stopService();
    } catch {}
  }

  private _cleanupListeners(): void {
    this.stopSub?.remove();
    this.tempStopSub?.remove();
    this.stopSub = null;
    this.tempStopSub = null;
  }

  /**
   * 订阅 configService 配置变化 + backgroundRuntimeState 临时禁用变化。
   * 任意一方变化时触发 refresh()，替代原先直接订阅 settingsStore 的方式。
   */
  private _subscribeToChanges(): void {
    if (this.configUnsub) return;

    this.configUnsub = configService.subscribe(() => {
      this.refresh().catch((e) =>
        console.error('[BackgroundServiceManager] refresh (config change) failed:', e)
      );
    });

    this.runtimeUnsub = backgroundRuntimeState.subscribe(() => {
      this.refresh().catch((e) =>
        console.error('[BackgroundServiceManager] refresh (runtime state change) failed:', e)
      );
    });
  }
}

export function getBackgroundServiceManager(): BackgroundServiceManager {
  return BackgroundServiceManager.getInstance();
}
