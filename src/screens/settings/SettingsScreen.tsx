/**
 * 设置页面入口：负责路由分组、页面布局和消息提示。
 * 各模块自行管理设置状态、权限检查和操作弹窗。
 */
import { MessageToast } from '@/components';
import { SettingItem } from '@/components/settings';
import { useMessageToast } from '@/hooks/useMessageToast';
import { useTheme } from '@/hooks/useTheme';
import type { SettingsDetailSection, SettingsStackParamList } from '@/navigation/types';
import { useSettingsStore } from '@/stores';
import type { StackScreenProps } from '@react-navigation/stack';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { ChevronRight } from 'react-native-feather';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AboutSettings } from './AboutSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { BackgroundSettings } from './BackgroundSettings';
import { LogsAndDebugSettings } from './LogsAndDebugSettings';
import { PermissionsSettings } from './PermissionsSettings';
import { ServerSettings } from './ServerSettings';
import { ShortcutSettings } from './ShortcutSettings';
import { StorageSettings } from './StorageSettings';
import { SyncAndHistorySettings } from './SyncAndHistorySettings';

const detailSections: { section: SettingsDetailSection; androidOnly?: boolean }[] = [
  { section: 'syncAndHistorySection' },
  { section: 'backgroundTasksSection', androidOnly: true },
  { section: 'permissionsSection', androidOnly: true },
  { section: 'storageSection' },
  { section: 'logsAndDebugSection' },
];

type Props = StackScreenProps<SettingsStackParamList, 'SettingsMain' | 'SettingsDetail'>;

/** 根据路由挂载对应设置模块，避免后台页面执行无关模块的初始化。 */
export const SettingsScreen = ({ navigation, route }: Props) => {
  const section = route.params?.section;
  const isMainPage = route.name === 'SettingsMain';
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { isLoaded, loadConfig } = useSettingsStore();
  const { message, showMessage, handleMessageShown } = useMessageToast();

  useEffect(() => {
    if (!isLoaded) void loadConfig();
  }, [isLoaded, loadConfig]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={[]}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {isMainPage && (
          <>
            <ServerSettings showMessage={showMessage} />
            <View
              style={[
                styles.detailMenu,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
              ]}
            >
              {detailSections
                .filter((item) => !item.androidOnly || Platform.OS === 'android')
                .map((item, index, items) => (
                  <SettingItem
                    key={item.section}
                    label={t(`settings.${item.section}`)}
                    showBorder={index < items.length - 1}
                    pressFeedback="highlight"
                    onPress={() => navigation.navigate('SettingsDetail', { section: item.section })}
                  >
                    <ChevronRight color={theme.colors.textSecondary} width={20} height={20} />
                  </SettingItem>
                ))}
            </View>
            <ShortcutSettings showMessage={showMessage} />
            <AppearanceSettings showMessage={showMessage} />
            <AboutSettings showMessage={showMessage} />
          </>
        )}
        {section === 'syncAndHistorySection' && (
          <SyncAndHistorySettings showMessage={showMessage} />
        )}
        {section === 'backgroundTasksSection' && Platform.OS === 'android' && (
          <BackgroundSettings showMessage={showMessage} />
        )}
        {section === 'permissionsSection' && Platform.OS === 'android' && <PermissionsSettings />}
        {section === 'storageSection' && <StorageSettings showMessage={showMessage} />}
        {section === 'logsAndDebugSection' && <LogsAndDebugSettings showMessage={showMessage} />}
      </ScrollView>
      <MessageToast message={message} onMessageShown={handleMessageShown} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 40 },
  detailMenu: {
    marginTop: 20,
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
