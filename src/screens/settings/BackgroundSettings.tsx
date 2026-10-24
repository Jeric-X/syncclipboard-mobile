import { SettingsSection, SettingSwitch } from '@/components/settings';
import { useSyncedState } from '@/hooks/useSyncedState';
import { configService } from '@/services/ConfigService';
import { requestServiceRuntime } from '@/services/ServiceRuntime';
import { useSettingsStore } from '@/stores';
import { requestNotificationPermission } from '@/utils/notificationPermission';
import { hasOverlayPermission, requestOverlayPermission } from 'clipboard-overlay';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Platform } from 'react-native';
import {
  hasShizukuPermission,
  isShizukuAvailable,
  requestShizukuPermission,
} from 'shizuku-clipboard';
import type { SettingsModuleProps } from './types';

/** 后台任务及 Android 保活和剪贴板访问设置。 */
export const BackgroundSettings = ({ showMessage }: SettingsModuleProps) => {
  const { t } = useTranslation();

  const {
    config,
    updateConfig,
    setEnableBackgroundDownload,
    setEnableBackgroundUpload,
    setEnableClipboardOverlay,
    setEnableBackgroundTasks,
    setEnableShizukuClipboard,
    isTempDisabledBackgroundTasks,
    setTempDisabledBackgroundTasks,
  } = useSettingsStore();

  const [localBackgroundDownloadEnabled, setLocalBackgroundDownloadEnabled] = useState(
    config?.enableBackgroundDownload ?? false
  );

  const [localBackgroundUploadEnabled, setLocalBackgroundUploadEnabled] = useState(
    config?.enableBackgroundUpload ?? false
  );

  const [localBackgroundTasksEnabled, setLocalBackgroundTasksEnabled] = useState(
    (config?.enableBackgroundTasks ?? false) && !isTempDisabledBackgroundTasks
  );

  const [localClipboardOverlayEnabled, setLocalClipboardOverlayEnabled] = useState(
    config?.enableClipboardOverlay ?? false
  );

  const [localShizukuClipboardEnabled, setLocalShizukuClipboardEnabled] = useState(
    config?.enableShizukuClipboard ?? false
  );

  const [localOverlayKeepAlive, setLocalOverlayKeepAlive] = useSyncedState(
    config?.enableOverlayKeepAlive ?? false
  );

  const [localShizukuRecovery, setLocalShizukuRecovery] = useSyncedState(
    config?.enableShizukuRecovery ?? false
  );

  const [localTileRecovery, setLocalTileRecovery] = useSyncedState(
    config?.enableTileRecovery ?? false
  );

  const [localForegroundServiceSticky, setLocalForegroundServiceSticky] = useSyncedState(
    config?.enableForegroundServiceSticky ?? true
  );

  const [localForegroundNotification, setLocalForegroundNotification] = useState(
    config?.enableForegroundNotification ?? true
  );

  useEffect(() => {
    setLocalBackgroundDownloadEnabled(config?.enableBackgroundDownload ?? false);
  }, [config?.enableBackgroundDownload]);

  useEffect(() => {
    setLocalBackgroundUploadEnabled(config?.enableBackgroundUpload ?? false);
  }, [config?.enableBackgroundUpload]);

  useEffect(() => {
    setLocalBackgroundTasksEnabled(
      (config?.enableBackgroundTasks ?? false) && !isTempDisabledBackgroundTasks
    );
  }, [config?.enableBackgroundTasks, isTempDisabledBackgroundTasks]);

  useEffect(() => {
    setLocalClipboardOverlayEnabled(config?.enableClipboardOverlay ?? false);
  }, [config?.enableClipboardOverlay]);

  useEffect(() => {
    setLocalShizukuClipboardEnabled(config?.enableShizukuClipboard ?? false);
  }, [config?.enableShizukuClipboard]);

  useEffect(() => {
    setLocalForegroundNotification(config?.enableForegroundNotification ?? true);
  }, [config?.enableForegroundNotification]);

  /** 用户主动恢复必须重新请求 Headless；共享入口负责等待上一轮停止完成。 */
  const enableBackgroundTasks = async () => {
    try {
      await requestServiceRuntime(true);
      await setEnableBackgroundTasks(true);
      setLocalBackgroundTasksEnabled(true);
    } catch (error: unknown) {
      setTempDisabledBackgroundTasks(true);
      setLocalBackgroundTasksEnabled(false);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换后台任务总开关
  const handleToggleBackgroundTasks = async (enabled: boolean) => {
    if (enabled) {
      if (isTempDisabledBackgroundTasks) {
        await enableBackgroundTasks();
        return;
      }
      Alert.alert(
        t('settings.enableBackgroundTasksTitle'),
        t('settings.enableBackgroundTasksMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.confirmEnable'), onPress: enableBackgroundTasks },
        ]
      );
      return;
    }

    setLocalBackgroundTasksEnabled(false);
    try {
      await setEnableBackgroundTasks(false);
    } catch (error: unknown) {
      setLocalBackgroundTasksEnabled(true);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换后台下载远程
  const handleToggleBackgroundDownload = async (enabled: boolean) => {
    if (enabled) {
      setLocalBackgroundDownloadEnabled(true);
      try {
        await setEnableBackgroundDownload(true);
      } catch (error: unknown) {
        setLocalBackgroundDownloadEnabled(false);
        showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
      }
      return;
    }

    setLocalBackgroundDownloadEnabled(false);
    try {
      await setEnableBackgroundDownload(false);
    } catch (error: unknown) {
      setLocalBackgroundDownloadEnabled(true);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换后台上传本地
  const handleToggleBackgroundUpload = async (enabled: boolean) => {
    if (enabled) {
      Alert.alert(
        t('settings.enableBackgroundUploadTitle'),
        t('settings.enableBackgroundUploadMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.confirmEnable'),
            onPress: async () => {
              setLocalBackgroundUploadEnabled(true);
              try {
                await setEnableBackgroundUpload(true);
              } catch (error: unknown) {
                setLocalBackgroundUploadEnabled(false);
                showMessage(
                  error instanceof Error ? error.message : t('common.setFailed'),
                  'error'
                );
              }
            },
          },
        ]
      );
      return;
    }

    setLocalBackgroundUploadEnabled(false);
    try {
      await setEnableBackgroundUpload(false);
    } catch (error: unknown) {
      setLocalBackgroundUploadEnabled(true);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  const handleToggleForegroundServiceSticky = async (enabled: boolean) => {
    setLocalForegroundServiceSticky(enabled);
    try {
      await configService.updateConfig({ enableForegroundServiceSticky: enabled });
    } catch (error: unknown) {
      setLocalForegroundServiceSticky(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  /** 两个 Shizuku 开关共用运行检查、授权和引导；授权后需再次开启。 */
  const ensureShizukuReady = (): boolean => {
    if (Platform.OS !== 'android') return false;
    if (!isShizukuAvailable()) {
      Alert.alert(t('settings.shizukuNotRunningTitle'), t('settings.shizukuNotRunningMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.learnMore'),
          onPress: () => Linking.openURL('https://shizuku.rikka.app/guide/setup/'),
        },
      ]);
      return false;
    }
    if (!hasShizukuPermission()) {
      if (!requestShizukuPermission()) {
        Alert.alert(
          t('settings.permissionRequestFailed'),
          t('settings.shizukuPermissionRequestFailed')
        );
        return false;
      }
      showMessage(t('settings.shizukuGrantThenEnable'), 'info');
      return false;
    }
    return true;
  };

  const handleToggleShizukuRecovery = async (enabled: boolean) => {
    if (enabled && !ensureShizukuReady()) return;
    setLocalShizukuRecovery(enabled);
    try {
      await configService.updateConfig({ enableShizukuRecovery: enabled });
    } catch (error: unknown) {
      setLocalShizukuRecovery(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  const handleToggleTileRecovery = async (enabled: boolean) => {
    setLocalTileRecovery(enabled);
    try {
      await configService.updateConfig({ enableTileRecovery: enabled });
    } catch (error: unknown) {
      setLocalTileRecovery(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  const handleToggleOverlayKeepAlive = async (enabled: boolean) => {
    if (enabled && !hasOverlayPermission()) {
      Alert.alert(t('settings.overlayKeepAlive'), t('settings.overlayKeepAlivePermission'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.goToSettings'), onPress: requestOverlayPermission },
      ]);
      return;
    }
    setLocalOverlayKeepAlive(enabled);
    try {
      await configService.updateConfig({ enableOverlayKeepAlive: enabled });
    } catch (error: unknown) {
      setLocalOverlayKeepAlive(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换悬浮窗获取剪贴板
  const handleToggleClipboardOverlay = async (enabled: boolean) => {
    if (enabled && Platform.OS === 'android') {
      Alert.alert(
        t('settings.enableClipboardOverlayTitle'),
        t('settings.enableClipboardOverlayMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('settings.confirmOk'),
            onPress: async () => {
              if (!hasOverlayPermission()) {
                requestOverlayPermission();
                return;
              }
              setLocalClipboardOverlayEnabled(true);
              try {
                await setEnableClipboardOverlay(true);
              } catch (error: unknown) {
                setLocalClipboardOverlayEnabled(false);
                showMessage(
                  error instanceof Error ? error.message : t('common.setFailed'),
                  'error'
                );
              }
            },
          },
        ]
      );
      return;
    }

    setLocalClipboardOverlayEnabled(enabled);

    try {
      await setEnableClipboardOverlay(enabled);
    } catch (error: unknown) {
      setLocalClipboardOverlayEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换 Shizuku 获取剪贴板
  const handleToggleShizukuClipboard = async (enabled: boolean) => {
    if (enabled && !ensureShizukuReady()) return;

    setLocalShizukuClipboardEnabled(enabled);
    try {
      await setEnableShizukuClipboard(enabled);
    } catch (error: unknown) {
      setLocalShizukuClipboardEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换前台服务常驻通知
  const handleToggleForegroundNotification = async (enabled: boolean) => {
    if (!enabled) {
      Alert.alert(
        t('settings.disableForegroundNotifTitle'),
        t('settings.disableForegroundNotifMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('settings.confirmClose'),
            onPress: async () => {
              setLocalForegroundNotification(false);
              try {
                await updateConfig({ enableForegroundNotification: false });
              } catch (error: unknown) {
                setLocalForegroundNotification(true);
                showMessage(
                  error instanceof Error ? error.message : t('common.setFailed'),
                  'error'
                );
              }
            },
          },
        ]
      );
      return;
    }

    setLocalForegroundNotification(true);
    try {
      await updateConfig({ enableForegroundNotification: true });
      await requestNotificationPermission();
    } catch (error: unknown) {
      setLocalForegroundNotification(false);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };
  return (
    <>
      <SettingsSection title={t('settings.backgroundTasksSection')}>
        <SettingSwitch
          label={t('settings.backgroundTasksToggle')}
          description={
            isTempDisabledBackgroundTasks ? t('settings.backgroundTasksTempStopped') : undefined
          }
          value={localBackgroundTasksEnabled}
          onChange={handleToggleBackgroundTasks}
        />

        <SettingSwitch
          label={t('settings.backgroundDownload')}
          value={localBackgroundTasksEnabled && localBackgroundDownloadEnabled}
          onChange={handleToggleBackgroundDownload}
          disabled={!localBackgroundTasksEnabled}
        />

        <SettingSwitch
          label={t('settings.backgroundUpload')}
          value={localBackgroundTasksEnabled && localBackgroundUploadEnabled}
          onChange={handleToggleBackgroundUpload}
          disabled={!localBackgroundTasksEnabled}
        />
      </SettingsSection>

      <SettingsSection title={t('settings.clipboardAccessSection')}>
        <SettingSwitch
          label={t('settings.clipboardOverlay')}
          value={localBackgroundTasksEnabled && localClipboardOverlayEnabled}
          onChange={handleToggleClipboardOverlay}
          disabled={!localBackgroundTasksEnabled}
        />

        <SettingSwitch
          label={t('settings.shizukuClipboard')}
          descriptionLink={{
            text: t('settings.shizukuWebsite'),
            onPress: () => Linking.openURL('https://shizuku.rikka.app/'),
          }}
          value={localBackgroundTasksEnabled && localShizukuClipboardEnabled}
          onChange={handleToggleShizukuClipboard}
          disabled={!localBackgroundTasksEnabled}
        />
      </SettingsSection>

      <SettingsSection
        title={t('settings.backgroundReliabilitySection')}
        description={t('settings.backgroundReliabilityDesc')}
      >
        <SettingSwitch
          label={t('settings.foregroundNotification')}
          value={localBackgroundTasksEnabled && localForegroundNotification}
          onChange={handleToggleForegroundNotification}
          disabled={!localBackgroundTasksEnabled}
        />

        <SettingSwitch
          label={t('settings.overlayKeepAlive')}
          value={localBackgroundTasksEnabled && localOverlayKeepAlive}
          onChange={handleToggleOverlayKeepAlive}
          disabled={!localBackgroundTasksEnabled}
        />
      </SettingsSection>

      <SettingsSection
        title={t('settings.backgroundRecoverySection')}
        description={t('settings.backgroundRecoveryDesc')}
      >
        <SettingSwitch
          label={t('settings.foregroundServiceSticky')}
          description={t('settings.foregroundServiceStickyDesc', {
            notification: t('settings.foregroundNotification'),
          })}
          value={
            localBackgroundTasksEnabled &&
            localForegroundNotification &&
            localForegroundServiceSticky
          }
          onChange={handleToggleForegroundServiceSticky}
          disabled={!localBackgroundTasksEnabled || !localForegroundNotification}
        />

        <SettingSwitch
          label={t('settings.shizukuRecovery')}
          value={localBackgroundTasksEnabled && localShizukuRecovery}
          onChange={handleToggleShizukuRecovery}
          disabled={!localBackgroundTasksEnabled}
        />

        <SettingSwitch
          label={t('settings.tileRecovery')}
          description={t('settings.tileRecoveryDesc')}
          value={localBackgroundTasksEnabled && localTileRecovery}
          onChange={handleToggleTileRecovery}
          disabled={!localBackgroundTasksEnabled}
        />
      </SettingsSection>
    </>
  );
};
