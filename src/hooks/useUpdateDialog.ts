import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { APP_VERSION } from '@/constants';
import { updateService } from '@/services/update';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ApkSource } from '@/utils/apkDownload';
import type { ReleaseAssetInfo } from '@/utils/update';
import type { MessageType } from '@/components/MessageToast';

type ShowMessage = (text: string, type: MessageType) => void;

/** 提供统一的新版本弹窗，并将下载任务交给 UpdateService。 */
export function useUpdateDialog(showMessage: ShowMessage): {
  showUpdateDialog: (version: string, assets: ReleaseAssetInfo[], releaseNotes?: string) => void;
} {
  const { t } = useTranslation();
  const channel = useSettingsStore((state) => state.config?.updateChannel ?? 'github');

  const downloadUpdate = useCallback(
    async (source: ApkSource, version: string, assets: ReleaseAssetInfo[]) => {
      try {
        await updateService.downloadAndInstall(source, version, assets);
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          showMessage(
            error instanceof Error ? error.message : t('common.operationFailed'),
            'error'
          );
        }
      }
    },
    [showMessage, t]
  );

  const showUpdateDialog = useCallback(
    (version: string, assets: ReleaseAssetInfo[], releaseNotes?: string) => {
      const channelName = channel === 'github' ? 'GitHub' : 'Gitee';
      const body = releaseNotes
        ? t('settings.newVersionMessageWithChannel', {
            newVersion: version,
            currentVersion: APP_VERSION,
            channel: channelName,
            notes: releaseNotes,
          })
        : t('settings.newVersionMessageNoNotesWithChannel', {
            newVersion: version,
            currentVersion: APP_VERSION,
            channel: channelName,
          });

      Alert.alert(t('settings.newVersionTitle'), body, [
        { text: t('common.later'), style: 'cancel' },
        {
          text: t('settings.updateNow'),
          onPress: () => void downloadUpdate(channel, version, assets),
        },
      ]);
    },
    [channel, downloadUpdate, t]
  );

  return { showUpdateDialog };
}
