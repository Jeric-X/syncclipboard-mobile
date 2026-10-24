import { ServerConfigModal, ServerListItem } from '@/components';
import { SettingItem, ThemedSwitch } from '@/components/settings';
import { useNetworkAutoSwitch } from '@/hooks/useNetworkAutoSwitch';
import { useTheme } from '@/hooks/useTheme';
import type { SettingsStackParamList } from '@/navigation/types';
import { getHistorySyncService } from '@/services/history/HistorySyncService';
import { networkAutoSwitchService } from '@/services/NetworkAutoSwitchService';
import { useSettingsStore } from '@/stores';
import { ServerConfig } from '@/types/api';
import { getNetworkAutoSwitchDescription } from '@/utils/networkAutoSwitch';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight, ChevronUp, Plus } from 'react-native-feather';
import type { SettingsModuleProps } from './types';

/** 服务器列表、编辑弹窗和网络自动切换入口。 */
export const ServerSettings = ({ showMessage }: SettingsModuleProps) => {
  const navigation = useNavigation<StackNavigationProp<SettingsStackParamList>>();
  const { theme } = useTheme();

  const { t } = useTranslation();

  const autoSwitchRuntime = useNetworkAutoSwitch();

  const {
    config,
    addServer,
    updateServer,
    deleteServer,
    setActiveServer,
    updateModule,
    updateNetworkAutoSwitch,
  } = useSettingsStore();

  const [showServerModal, setShowServerModal] = useState(false);

  const [editingServerIndex, setEditingServerIndex] = useState<number | null>(null);

  const [serversCollapsed, setServersCollapsed] = useState(true);

  // 获取服务器列表
  const servers = config?.servers || [];

  const activeServerIndex = config?.activeServerIndex ?? -1;

  const activeServer = activeServerIndex >= 0 ? servers[activeServerIndex] : null;

  // 处理添加服务器
  const handleAddServer = () => {
    setEditingServerIndex(null);
    setShowServerModal(true);
  };

  // 处理编辑服务器
  const handleEditServer = (index: number) => {
    setEditingServerIndex(index);
    setShowServerModal(true);
  };

  // 处理保存服务器
  const handleSaveServer = async (serverConfig: ServerConfig) => {
    try {
      if (editingServerIndex !== null) {
        await updateServer(editingServerIndex, serverConfig);
        showMessage(t('settings.serverUpdated'), 'success');
      } else {
        await addServer(serverConfig);
        showMessage(t('settings.serverAdded'), 'success');
      }
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
  };

  // 处理删除服务器
  const handleDeleteServer = async (index: number) => {
    try {
      await deleteServer(index);
      showMessage(t('settings.serverDeleted'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
  };

  // 处理切换激活服务器
  const handleSetActiveServer = async (index: number) => {
    if (index === activeServerIndex) {
      if (servers.length > 1) {
        setServersCollapsed(true);
      }
      return;
    }

    if (servers.length > 1) {
      setServersCollapsed(true);
    }

    if (config?.networkAutoSwitch.enabled) {
      networkAutoSwitchService.beginManualOverride();
    }

    try {
      const syncService = getHistorySyncService();
      syncService.cancelAll();
    } catch {
      // ignore
    }

    try {
      await setActiveServer(index);
      await updateModule('history', { needsHistoryReorganize: true });
      showMessage(t('settings.serverSwitched'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('common.operationFailed'), 'error');
    }
  };

  const handleNetworkAutoSwitchToggle = (enabled: boolean) => {
    if (enabled && servers.length === 0) {
      Alert.alert(t('networkAutoSwitch.title'), t('networkAutoSwitch.needServer'), [
        { text: t('common.confirm') },
      ]);
      return;
    }
    void updateNetworkAutoSwitch({ enabled });
  };
  return (
    <>
      <View style={styles.section}>
        <View style={[styles.sectionHeaderBase, styles.sectionHeaderRow]}>
          <TouchableOpacity
            style={styles.sectionTitleContainer}
            onPress={() => servers.length > 1 && setServersCollapsed(!serversCollapsed)}
            disabled={servers.length <= 1}
          >
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
              {t('settings.serverSection')}
            </Text>
            {servers.length > 1 && (
              <View style={styles.collapseIcon}>
                {serversCollapsed ? (
                  <ChevronDown color={theme.colors.textSecondary} width={18} height={18} />
                ) : (
                  <ChevronUp color={theme.colors.textSecondary} width={18} height={18} />
                )}
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={handleAddServer}>
            <Plus color={theme.colors.primary} width={20} height={20} />
          </TouchableOpacity>
        </View>

        {servers.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
              {t('settings.noServers')}
            </Text>
            <Text style={[styles.emptyHint, { color: theme.colors.textTertiary }]}>
              {t('settings.noServersHint')}
            </Text>
          </View>
        ) : serversCollapsed && servers.length > 1 ? (
          activeServer && (
            <ServerListItem
              config={activeServer}
              isActive={true}
              onPress={() => {}}
              onEdit={() => handleEditServer(activeServerIndex)}
              onDelete={() => handleDeleteServer(activeServerIndex)}
              affectedRuleCount={
                config?.networkAutoSwitch.rules.filter(
                  (rule) => rule.targetServerId === activeServer.id
                ).length
              }
            />
          )
        ) : (
          servers.map((server, index) => (
            <ServerListItem
              key={server.id ?? index}
              config={server}
              isActive={index === activeServerIndex}
              onPress={() => handleSetActiveServer(index)}
              onEdit={() => handleEditServer(index)}
              onDelete={() => handleDeleteServer(index)}
              affectedRuleCount={
                config?.networkAutoSwitch.rules.filter((rule) => rule.targetServerId === server.id)
                  .length
              }
            />
          ))
        )}
        {servers.length > 0 && (
          <View
            style={[
              styles.autoSwitchCard,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
            ]}
          >
            <SettingItem
              label={t('networkAutoSwitch.title')}
              description={
                config?.networkAutoSwitch.enabled
                  ? getNetworkAutoSwitchDescription(true, autoSwitchRuntime, t)
                  : undefined
              }
              descriptionLink={
                config?.networkAutoSwitch.enabled && autoSwitchRuntime.manualOverride
                  ? {
                      text: t('networkAutoSwitch.restoreAuto'),
                      onPress: () => void networkAutoSwitchService.clearManualOverride(),
                    }
                  : undefined
              }
              showBorder={false}
              pressFeedback="highlight"
              onPress={() => navigation.navigate('NetworkAutoSwitch')}
            >
              <View style={styles.autoSwitchControls}>
                <ThemedSwitch
                  testID="settings-network-auto-switch"
                  value={config?.networkAutoSwitch.enabled ?? false}
                  onValueChange={handleNetworkAutoSwitchToggle}
                />
                <ChevronRight color={theme.colors.textSecondary} width={20} height={20} />
              </View>
            </SettingItem>
          </View>
        )}
      </View>
      <ServerConfigModal
        visible={showServerModal}
        onClose={() => setShowServerModal(false)}
        onSave={handleSaveServer}
        initialConfig={editingServerIndex !== null ? servers[editingServerIndex] : undefined}
        isEditing={editingServerIndex !== null}
      />
    </>
  );
};

const styles = StyleSheet.create({
  section: {
    marginTop: 20,
  },
  sectionHeaderBase: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  collapseIcon: {
    marginTop: 1,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyCard: {
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 14,
    textAlign: 'center',
  },
  autoSwitchControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  autoSwitchCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
