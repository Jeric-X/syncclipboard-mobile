import {
  SettingAction,
  SettingDropdown,
  SettingItem,
  SettingsSection,
  SettingSwitch,
} from '@/components/settings';
import { APP_VERSION } from '@/constants';
import { useTheme } from '@/hooks/useTheme';
import { useUpdateDialog } from '@/hooks/useUpdateDialog';
import { updateService } from '@/services/update';
import { useUpdateServiceStore } from '@/serviceState/UpdateState';
import { useSettingsStore } from '@/stores';
import type { ReleaseAssetInfo } from '@/utils/update';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, TouchableOpacity } from 'react-native';
import type { SettingsModuleProps } from './types';

/** 应用信息、更新检查和下载操作。 */
export const AboutSettings = ({ showMessage }: SettingsModuleProps) => {
  const { theme } = useTheme();

  const { t } = useTranslation();

  const { config, setAutoCheckUpdate, setUpdateToBeta, setUpdateChannel } = useSettingsStore();

  const { showUpdateDialog } = useUpdateDialog(showMessage);

  const [localAutoCheckUpdateEnabled, setLocalAutoCheckUpdateEnabled] = useState(
    config?.autoCheckUpdate ?? true
  );

  const [localUpdateToBetaEnabled, setLocalUpdateToBetaEnabled] = useState(
    config?.updateToBeta ?? false
  );

  const [localUpdateChannel, setLocalUpdateChannel] = useState<'github' | 'gitee'>(
    config?.updateChannel ?? 'github'
  );

  const {
    isChecking: isCheckingUpdate,
    updateAvailable,
    latestVersion,
    assets: latestAssets,
    releaseNotes,
    isDownloading,
    downloadProgress,
  } = useUpdateServiceStore();

  const appVersion = APP_VERSION;

  // 当配置中的autoCheckUpdate值变化时，更新本地状态
  useEffect(() => {
    setLocalAutoCheckUpdateEnabled(config?.autoCheckUpdate ?? true);
  }, [config?.autoCheckUpdate]);

  useEffect(() => {
    setLocalUpdateToBetaEnabled(config?.updateToBeta ?? false);
  }, [config?.updateToBeta]);

  useEffect(() => {
    setLocalUpdateChannel(config?.updateChannel ?? 'github');
  }, [config?.updateChannel]);

  // 处理切换自动检查更新
  const handleToggleAutoCheckUpdate = async (enabled: boolean) => {
    setLocalAutoCheckUpdateEnabled(enabled);
    try {
      await setAutoCheckUpdate(enabled);
    } catch (error: unknown) {
      setLocalAutoCheckUpdateEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 处理切换更新到测试版
  const handleToggleUpdateToBeta = async (enabled: boolean) => {
    setLocalUpdateToBetaEnabled(enabled);
    try {
      await setUpdateToBeta(enabled);
    } catch (error: unknown) {
      setLocalUpdateToBetaEnabled(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  const handleToggleUpdateChannel = async (channel: 'github' | 'gitee') => {
    updateService.reset();

    setLocalUpdateChannel(channel);
    try {
      await setUpdateChannel(channel);
    } catch (error: unknown) {
      setLocalUpdateChannel(channel === 'github' ? 'gitee' : 'github');
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };

  // 执行更新检查逻辑
  const runUpdateCheck = async (showNoUpdateToast: boolean, includeBeta?: boolean) => {
    try {
      const result = await updateService.checkForUpdates(includeBeta);
      if (result.hasUpdate) {
        showUpdateDialog(result.latestVersion, result.assets, result.releaseNotes);
      } else if (showNoUpdateToast) {
        showMessage(t('settings.alreadyLatest'), 'success');
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      if (showNoUpdateToast) {
        showMessage(t('settings.checkUpdateFailed'), 'error');
      }
    }
  };

  // 取消更新检查
  const handleCancelUpdateCheck = () => {
    updateService.cancelCheck();
    showMessage(t('settings.updateCheckCancelled'), 'info');
  };

  // 点击"更新"按钮：先检查缓存，有则直接安装，否则弹渠道选择
  const handleUpdateButtonPress = async (
    version: string,
    assets: ReleaseAssetInfo[],
    releaseNotes?: string
  ) => {
    if (isDownloading) return;

    try {
      const installed = await updateService.installCachedUpdate(version, assets);
      if (installed) return;
      showUpdateDialog(version, assets, releaseNotes);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
  };

  // 取消下载对话框
  const handleCancelDownload = () => {
    Alert.alert(t('settings.cancelDownloadTitle'), t('settings.cancelDownloadMessage'), [
      { text: t('settings.continueDownload'), style: 'cancel' },
      {
        text: t('settings.cancelDownloadTitle'),
        style: 'destructive',
        onPress: () => {
          updateService.cancelDownload();
          showMessage(t('settings.downloadCanceled'), 'info');
        },
      },
    ]);
  };
  return (
    <SettingsSection title={t('settings.aboutSection')}>
      <SettingAction
        label={`${t('settings.version')} ${appVersion}`}
        buttonText={
          isCheckingUpdate
            ? t('settings.checkingUpdate')
            : isDownloading
              ? t('settings.downloadingUpdate', {
                  percent: Math.round(downloadProgress * 100),
                })
              : updateAvailable
                ? t('settings.updateAvailable', { version: latestVersion })
                : t('settings.checkUpdate')
        }
        buttonStyle={isDownloading || updateAvailable ? 'primary' : 'secondary'}
        onPress={() => {
          if (isCheckingUpdate) {
            handleCancelUpdateCheck();
          } else if (isDownloading) {
            handleCancelDownload();
          } else if (updateAvailable) {
            handleUpdateButtonPress(latestVersion ?? '', latestAssets, releaseNotes);
          } else {
            runUpdateCheck(true, localUpdateToBetaEnabled);
          }
        }}
      />

      <SettingSwitch
        label={t('settings.autoCheckUpdate')}
        value={localAutoCheckUpdateEnabled}
        onChange={handleToggleAutoCheckUpdate}
      />

      <SettingSwitch
        label={t('settings.updateToBeta')}
        value={localUpdateToBetaEnabled}
        onChange={handleToggleUpdateToBeta}
      />

      <SettingDropdown
        label={t('settings.updateChannel')}
        options={[
          { label: 'Gitee', value: 'gitee' as const },
          { label: 'GitHub', value: 'github' as const },
        ]}
        value={localUpdateChannel}
        onChange={(value) => handleToggleUpdateChannel(value)}
      />

      <SettingItem description={t('settings.openSource')}>
        <TouchableOpacity
          onPress={() => Linking.openURL('https://github.com/Jeric-X/syncclipboard-mobile')}
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
        >
          <MaterialCommunityIcons name="github" size={24} color={theme.colors.textTertiary} />
        </TouchableOpacity>
      </SettingItem>
    </SettingsSection>
  );
};
