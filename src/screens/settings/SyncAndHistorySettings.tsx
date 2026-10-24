import {
  SettingAction,
  SettingDropdown,
  SettingInput,
  SettingsSection,
  SettingSwitch,
} from '@/components/settings';
import { getHistorySyncService } from '@/services/history/HistorySyncService';
import { historyStorage } from '@/storage';
import { useSettingsStore } from '@/stores';
import { requestNotificationPermission } from '@/utils/notificationPermission';
import { Directory } from 'expo-file-system';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';
import { setStaticReceiverEnabled } from 'sms-forwarder';
import type { SettingsModuleProps } from './types';

/** 同步、历史记录和短信自动化设置。 */
export const SyncAndHistorySettings = ({ showMessage }: SettingsModuleProps) => {
  const { t } = useTranslation();

  const {
    config,
    setAutoSync,
    setAutoDownloadMaxSize,
    updateConfig,
    setEnableHistorySync,
    setRemotePollingInterval,
    setLocalPollingInterval,
    setEnableSmsForwarding,
    setAutoSaveSyncFile,
    setSyncFileSavePath,
  } = useSettingsStore();

  // 本地状态用于跟踪Switch的当前值，避免闪烁
  const [localAutoSyncEnabled, setLocalAutoSyncEnabled] = useState(config?.autoSync ?? false);

  const [localHistorySyncEnabled, setLocalHistorySyncEnabled] = useState(
    config?.enableHistorySync ?? false
  );

  const [localSmsForwardingEnabled, setLocalSmsForwardingEnabled] = useState(
    config?.enableSmsForwarding ?? false
  );

  const [localAutoSaveSyncFileEnabled, setLocalAutoSaveSyncFileEnabled] = useState(
    config?.autoSaveSyncFile ?? false
  );

  const [localSyncFileSavePath, setLocalSyncFileSavePath] = useState(
    config?.syncFileSavePath ?? ''
  );

  const [localSyncToastEnabled, setLocalSyncToastEnabled] = useState(
    config?.syncToastEnabled ?? true
  );

  const [localImageAutoDownload, setLocalImageAutoDownload] = useState<'wifi' | 'always' | 'off'>(
    config?.historyImageAutoDownload ?? 'wifi'
  );

  // 当配置中的autoSync值变化时，更新本地状态
  useEffect(() => {
    setLocalAutoSyncEnabled(config?.autoSync ?? false);
  }, [config?.autoSync]);

  useEffect(() => {
    setLocalHistorySyncEnabled(config?.enableHistorySync ?? true);
  }, [config?.enableHistorySync]);

  useEffect(() => {
    setLocalSmsForwardingEnabled(config?.enableSmsForwarding ?? false);
  }, [config?.enableSmsForwarding]);

  useEffect(() => {
    setLocalAutoSaveSyncFileEnabled(config?.autoSaveSyncFile ?? false);
  }, [config?.autoSaveSyncFile]);

  useEffect(() => {
    setLocalSyncFileSavePath(config?.syncFileSavePath ?? '');
  }, [config?.syncFileSavePath]);

  useEffect(() => {
    setLocalSyncToastEnabled(config?.syncToastEnabled ?? true);
  }, [config?.syncToastEnabled]);

  useEffect(() => {
    setLocalImageAutoDownload(config?.historyImageAutoDownload ?? 'wifi');
  }, [config?.historyImageAutoDownload]);

  const imageAutoDownloadOptions: { label: string; value: 'wifi' | 'always' | 'off' }[] = [
    { label: t('settings.imageAutoDownloadWifi'), value: 'wifi' },
    { label: t('settings.imageAutoDownloadAlways'), value: 'always' },
    { label: t('settings.imageAutoDownloadOff'), value: 'off' },
  ];

  // 获取服务器列表
  const servers = config?.servers || [];

  const activeServerIndex = config?.activeServerIndex ?? -1;

  const activeServer = activeServerIndex >= 0 ? servers[activeServerIndex] : null;

  const autoDownloadMaxSizeMB = Math.round(
    (config?.autoDownloadMaxSize ?? 5 * 1024 * 1024) / (1024 * 1024)
  );

  // 本地 state 用于输入框
  const [maxSizeInput, setMaxSizeInput] = useState(autoDownloadMaxSizeMB.toString());

  const [maxHistoryItemsInput, setMaxHistoryItemsInput] = useState(
    (config?.maxHistoryItems ?? 1000).toString()
  );

  const [remotePollingInput, setRemotePollingInput] = useState(
    ((config?.remotePollingInterval ?? 3000) / 1000).toString()
  );

  const [localPollingInput, setLocalPollingInput] = useState(
    ((config?.localPollingInterval ?? 1000) / 1000).toString()
  );

  // 处理切换自动复制
  const handleToggleAutoSync = async (enabled: boolean) => {
    // 立即更新本地状态，避免闪烁
    setLocalAutoSyncEnabled(enabled);

    try {
      await setAutoSync(enabled);
    } catch (error: unknown) {
      // 如果设置失败，恢复原来的状态
      setLocalAutoSyncEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换自动上传短信验证码
  const handleToggleSmsForwarding = async (enabled: boolean) => {
    if (enabled && Platform.OS === 'android') {
      const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
      if (!granted) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert(t('settings.smsPermissionTitle'), t('settings.smsPermissionMessage'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.goToSettings'), onPress: () => Linking.openSettings() },
          ]);
          return;
        }
      }
    }

    setLocalSmsForwardingEnabled(enabled);
    try {
      await setEnableSmsForwarding(enabled);
      // 同步静态短信接收器状态
      if (Platform.OS === 'android') {
        setStaticReceiverEnabled(enabled);
      }
      if (enabled) {
        await requestNotificationPermission();
      }
    } catch (error: unknown) {
      setLocalSmsForwardingEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换自动保存同步文件
  const handleToggleAutoSaveSyncFile = async (enabled: boolean) => {
    setLocalAutoSaveSyncFileEnabled(enabled);
    try {
      await setAutoSaveSyncFile(enabled);
    } catch (error: unknown) {
      setLocalAutoSaveSyncFileEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理选择同步文件保存路径
  const handlePickSyncFileSavePath = async () => {
    try {
      const directory = await Directory.pickDirectoryAsync();
      if (directory) {
        const path = directory.uri;
        setLocalSyncFileSavePath(path);
        await setSyncFileSavePath(path);
        showMessage(t('settings.syncFileSavePathSet'), 'success');
      }
    } catch (error: unknown) {
      // 用户取消选择不显示错误
      if (error instanceof Error && !error.message.includes('cancelled')) {
        showMessage(error.message, 'error');
      }
    }
  };

  // 处理最大文件大小输入
  const handleMaxSizeBlur = async () => {
    try {
      const sizeMB = parseInt(maxSizeInput, 10);
      if (isNaN(sizeMB) || sizeMB < 0) {
        setMaxSizeInput(autoDownloadMaxSizeMB.toString());
        showMessage(t('settings.invalidNumber'), 'error');
        return;
      }
      const sizeInBytes = sizeMB * 1024 * 1024;
      await setAutoDownloadMaxSize(sizeInBytes);
      showMessage(t('settings.maxSizeSet', { size: sizeMB }), 'success');
    } catch (error: unknown) {
      setMaxSizeInput(autoDownloadMaxSizeMB.toString());
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理历史记录最大保留条数输入
  const handleMaxHistoryItemsBlur = async () => {
    try {
      const maxItems = parseInt(maxHistoryItemsInput, 10);
      if (isNaN(maxItems) || maxItems < 10) {
        setMaxHistoryItemsInput((config?.maxHistoryItems ?? 1000).toString());
        showMessage(t('settings.numberMin10'), 'error');
        return;
      }
      await updateConfig({ maxHistoryItems: maxItems });
      showMessage(t('settings.maxHistoryItemsSet', { count: maxItems }), 'success');

      // 更新历史记录存储的最大大小
      historyStorage.setMaxHistorySize(maxItems);
    } catch (error: unknown) {
      setMaxHistoryItemsInput((config?.maxHistoryItems ?? 1000).toString());
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理远程轮询间隔输入
  const handleRemotePollingBlur = async () => {
    try {
      const seconds = parseInt(remotePollingInput, 10);
      if (isNaN(seconds) || seconds < 1) {
        setRemotePollingInput(((config?.remotePollingInterval ?? 3000) / 1000).toString());
        showMessage(t('settings.numberMin1'), 'error');
        return;
      }
      const ms = seconds * 1000;
      await setRemotePollingInterval(ms);
      showMessage(t('settings.remotePollingSet', { seconds }), 'success');
    } catch (error: unknown) {
      setRemotePollingInput(((config?.remotePollingInterval ?? 3000) / 1000).toString());
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理本地轮询间隔输入
  const handleLocalPollingBlur = async () => {
    try {
      const seconds = parseInt(localPollingInput, 10);
      if (isNaN(seconds) || seconds < 1) {
        setLocalPollingInput(((config?.localPollingInterval ?? 1000) / 1000).toString());
        showMessage(t('settings.numberMin1'), 'error');
        return;
      }
      const ms = seconds * 1000;
      await setLocalPollingInterval(ms);
      showMessage(t('settings.localPollingSet', { seconds }), 'success');
    } catch (error: unknown) {
      setLocalPollingInput(((config?.localPollingInterval ?? 1000) / 1000).toString());
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 过滤输入，只允许正整数
  const filterPositiveInteger = (value: string): string => {
    const filtered = value.replace(/[^0-9]/g, '');
    if (filtered === '') return '';
    const num = parseInt(filtered, 10);
    return num > 0 ? filtered : '';
  };

  const handleToggleHistorySync = async (enabled: boolean) => {
    try {
      const syncService = getHistorySyncService();
      syncService.cancelAll();

      if (!enabled) {
        await syncService.resetSyncCursor();
      }
    } catch {
      // ignore
    }

    setLocalHistorySyncEnabled(enabled);
    try {
      await setEnableHistorySync(enabled);

      if (!enabled) {
        await updateConfig({ needsHistoryReorganize: true });
      }
    } catch (error: unknown) {
      setLocalHistorySyncEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理历史记录图片自动下载设置变更
  const handleImageAutoDownloadChange = async (value: 'wifi' | 'always' | 'off') => {
    setLocalImageAutoDownload(value);
    try {
      await updateConfig({ historyImageAutoDownload: value });
    } catch {
      setLocalImageAutoDownload(config?.historyImageAutoDownload ?? 'wifi');
    }
  };

  // 处理切换同步 Toast 通知
  const handleToggleSyncToast = async (enabled: boolean) => {
    setLocalSyncToastEnabled(enabled);
    try {
      await updateConfig({ syncToastEnabled: enabled });
    } catch (error: unknown) {
      setLocalSyncToastEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };
  return (
    <>
      {/* 同步设置部分 */}
      <SettingsSection title={t('settings.syncSection')}>
        <SettingSwitch
          label={t('settings.autoSync')}
          description={t('settings.autoSyncDesc')}
          value={localAutoSyncEnabled}
          onChange={handleToggleAutoSync}
        />

        <SettingSwitch
          label={t('settings.syncToast')}
          description={t('settings.syncToastDesc')}
          value={localSyncToastEnabled}
          onChange={handleToggleSyncToast}
        />

        <SettingInput
          label={t('settings.autoDownloadMaxSize')}
          description={t('settings.autoDownloadMaxSizeDesc')}
          value={maxSizeInput}
          onChangeText={setMaxSizeInput}
          onBlur={handleMaxSizeBlur}
          unit="MB"
          keyboardType="number-pad"
          placeholder="5"
        />

        {activeServer?.type !== 'syncclipboard' && (
          <SettingInput
            label={t('settings.remotePollingInterval')}
            value={remotePollingInput}
            onChangeText={setRemotePollingInput}
            onBlur={handleRemotePollingBlur}
            unit={t('settings.unitSecond')}
            keyboardType="number-pad"
            placeholder="3"
            filter={filterPositiveInteger}
          />
        )}

        <SettingInput
          label={t('settings.localPollingInterval')}
          value={localPollingInput}
          onChangeText={setLocalPollingInput}
          onBlur={handleLocalPollingBlur}
          unit={t('settings.unitSecond')}
          keyboardType="number-pad"
          placeholder="1"
          filter={filterPositiveInteger}
        />

        <SettingSwitch
          label={t('settings.autoSaveSyncFile')}
          description={t('settings.autoSaveSyncFileDesc')}
          value={localAutoSaveSyncFileEnabled}
          onChange={handleToggleAutoSaveSyncFile}
        />

        {localAutoSaveSyncFileEnabled && (
          <SettingAction
            label={t('settings.syncFileSavePath')}
            description={localSyncFileSavePath || t('settings.syncFileSavePathNotSet')}
            buttonText={t('settings.syncFileSavePathPick')}
            onPress={handlePickSyncFileSavePath}
          />
        )}
      </SettingsSection>

      {/* 历史记录部分 */}
      <SettingsSection title={t('settings.historySection')}>
        <SettingSwitch
          label={t('settings.historySync')}
          description={
            activeServer?.type !== 'syncclipboard'
              ? t('settings.historySyncNotSupported')
              : t('settings.historySyncDesc')
          }
          value={localHistorySyncEnabled && activeServer?.type === 'syncclipboard'}
          onChange={handleToggleHistorySync}
          disabled={activeServer?.type !== 'syncclipboard'}
        />

        <SettingInput
          label={t('settings.maxHistoryItems')}
          description={t('settings.maxHistoryItemsDesc')}
          value={maxHistoryItemsInput}
          onChangeText={setMaxHistoryItemsInput}
          onBlur={handleMaxHistoryItemsBlur}
          unit={t('settings.unitItem')}
          keyboardType="number-pad"
          placeholder="100"
        />

        <SettingDropdown
          label={t('settings.imageAutoDownload')}
          options={imageAutoDownloadOptions}
          value={localImageAutoDownload}
          onChange={handleImageAutoDownloadChange}
        />

        <SettingSwitch
          label={t('settings.showImageCopyButton')}
          description={t('settings.showImageCopyButtonDesc')}
          value={config?.showImageCopyButton ?? false}
          onChange={(enabled) => updateConfig({ showImageCopyButton: enabled })}
        />
      </SettingsSection>

      {/* 短信自动化部分 */}
      {Platform.OS === 'android' && (
        <SettingsSection title={t('settings.smsSection')}>
          <SettingSwitch
            label={t('settings.smsForwarding')}
            value={localSmsForwardingEnabled}
            onChange={handleToggleSmsForwarding}
          />
        </SettingsSection>
      )}
    </>
  );
};
