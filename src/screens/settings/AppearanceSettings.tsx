import { SettingDropdown, SettingsSection, SettingSwitch } from '@/components/settings';
import { useI18n } from '@/hooks/useI18n';
import { useTheme } from '@/hooks/useTheme';
import type { Language } from '@/i18n';
import { useSettingsStore } from '@/stores';
import type { ThemeMode } from '@/theme';
import { setExcludeFromRecents } from 'native-util';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import type { SettingsModuleProps } from './types';

/** 语言、主题和最近任务显示设置。 */
export const AppearanceSettings = ({ showMessage }: SettingsModuleProps) => {
  const { themeMode, setThemeMode } = useTheme();

  const { t } = useTranslation();

  const { language: currentLanguage, systemLanguage, setLanguage } = useI18n();

  const { config, updateConfig } = useSettingsStore();

  const [localHideFromRecents, setLocalHideFromRecents] = useState(
    config?.hideFromRecents ?? false
  );

  useEffect(() => {
    setLocalHideFromRecents(config?.hideFromRecents ?? false);
  }, [config?.hideFromRecents]);

  const themeOptions: { label: string; value: ThemeMode }[] = [
    { label: t('settings.themeAuto'), value: 'auto' },
    { label: t('settings.themeLight'), value: 'light' },
    { label: t('settings.themeDark'), value: 'dark' },
  ];

  // 语言选项：zh/en label 用 native 名称（中文/English），auto label 跟随 UI 语言并标注当前系统语言
  const langNativeNames: Record<string, string> = {
    zh: t('settings.languageZh'),
    en: t('settings.languageEn'),
  };

  const languageOptions: { label: string; value: Language }[] = [
    {
      label: `${t('settings.languageAuto')}（${
        langNativeNames[systemLanguage] ?? systemLanguage
      }）`,
      value: 'auto',
    },
    { label: langNativeNames['zh'] ?? t('settings.languageZh'), value: 'zh' as Language },
    { label: 'English', value: 'en' },
  ];

  // 处理切换最近任务隐藏
  const handleToggleHideFromRecents = async (enabled: boolean) => {
    setLocalHideFromRecents(enabled);
    try {
      if (Platform.OS === 'android') {
        setExcludeFromRecents(enabled);
      }
      await updateConfig({ hideFromRecents: enabled });
    } catch (error: unknown) {
      setLocalHideFromRecents(!enabled);
      showMessage(error instanceof Error ? error.message : t('common.setFailed'), 'error');
    }
  };
  return (
    <SettingsSection title={t('settings.appearanceSection')}>
      <SettingDropdown
        label={t('settings.language')}
        options={languageOptions}
        value={currentLanguage}
        onChange={(value) => setLanguage(value)}
      />

      <SettingDropdown
        label={t('settings.theme')}
        options={themeOptions}
        value={themeMode}
        onChange={(value) => setThemeMode(value)}
      />

      {Platform.OS === 'android' && (
        <SettingSwitch
          label={t('settings.hideFromRecents')}
          description={t('settings.hideFromRecentsDesc')}
          value={localHideFromRecents}
          onChange={handleToggleHideFromRecents}
        />
      )}
    </SettingsSection>
  );
};
