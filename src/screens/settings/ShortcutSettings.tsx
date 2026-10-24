import { SettingAction, SettingsSection } from '@/components/settings';
import { shortcut } from '@/utils';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsModuleProps } from './types';

/** 桌面上传和下载快捷方式。 */
export const ShortcutSettings = ({ showMessage }: SettingsModuleProps) => {
  const { t } = useTranslation();

  // 处理添加下载快捷方式
  const handleAddDownloadShortcut = async () => {
    try {
      await shortcut.addDownloadShortcut();
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
  };

  // 处理添加上传快捷方式
  const handleAddUploadShortcut = async () => {
    try {
      await shortcut.addUploadShortcut();
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
  };
  return (
    <SettingsSection title={t('settings.shortcutsSection')}>
      <SettingAction
        label={t('settings.addDownloadShortcut')}
        buttonText={t('common.add')}
        onPress={handleAddDownloadShortcut}
      />

      <SettingAction
        label={t('settings.addUploadShortcut')}
        buttonText={t('common.add')}
        onPress={handleAddUploadShortcut}
      />
    </SettingsSection>
  );
};
