import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { StackScreenProps } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronDown, ChevronRight, ChevronUp, Edit3, Plus, Trash2 } from 'react-native-feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores/settingsStore';
import type { SettingsStackParamList } from '@/navigation/types';
import type {
  NetworkAutoSwitchRule,
  NetworkNoMatchAction,
  NetworkSwitchNotificationMode,
} from '@/types/networkAutoSwitch';
import { networkAutoSwitchService } from '@/services/NetworkAutoSwitchService';
import { useNetworkAutoSwitch } from '@/hooks/useNetworkAutoSwitch';
import { requestNotificationPermission } from '@/utils/notificationPermission';
import { ServerSelect } from '@/components';
import { SettingDropdown, SettingItem, SettingSwitch, ThemedSwitch } from '@/components/settings';

type Props = StackScreenProps<SettingsStackParamList, 'NetworkAutoSwitch'>;

export const NetworkAutoSwitchScreen = ({ navigation }: Props) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const {
    config,
    updateNetworkAutoSwitch,
    saveNetworkAutoSwitchRule,
    deleteNetworkAutoSwitchRule,
    moveNetworkAutoSwitchRule,
  } = useSettingsStore();
  const autoSwitch = config?.networkAutoSwitch;
  const servers = config?.servers ?? [];
  const runtime = useNetworkAutoSwitch();
  const snapshot = runtime.snapshot;
  const evaluation = runtime.evaluation;
  const detecting = runtime.phase === 'detecting';
  const detectError = runtime.error;
  const refresh = useCallback(() => networkAutoSwitchService.refresh(), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const serverName = useCallback(
    (id: string | null | undefined) => {
      if (!id) return t('networkAutoSwitch.actionNone');
      const server = servers.find((item) => item.id === id);
      return server?.name || server?.url || t('networkAutoSwitch.missingTarget');
    },
    [servers, t]
  );

  const statusText = useMemo(() => {
    if (!autoSwitch?.enabled) return t('networkAutoSwitch.statusDisabled');
    if (detecting) return t('networkAutoSwitch.statusDetecting');
    if (detectError) return t('networkAutoSwitch.loadingFailed', { message: detectError });
    if (runtime.manualOverride) return t('networkAutoSwitch.statusManualOverride');
    if (!evaluation) return t('networkAutoSwitch.statusDetecting');
    switch (evaluation.reason) {
      case 'waiting-for-network':
        return t('networkAutoSwitch.statusWaiting');
      case 'matched-rule':
        return t('networkAutoSwitch.statusMatched', {
          rule: evaluation.matchedRuleName,
          server: serverName(evaluation.targetServerId),
        });
      case 'matched-missing-target':
        return t('networkAutoSwitch.statusMissingTarget', { rule: evaluation.matchedRuleName });
      case 'no-match-default':
        return t('networkAutoSwitch.statusDefault', {
          server: serverName(evaluation.targetServerId),
        });
      case 'no-match-none':
      case 'no-match-missing-default':
        return t('networkAutoSwitch.statusNone');
      default:
        return t('networkAutoSwitch.statusKeep');
    }
  }, [
    autoSwitch?.enabled,
    detectError,
    detecting,
    evaluation,
    runtime.manualOverride,
    serverName,
    t,
  ]);

  if (!config || !autoSwitch) return null;

  const updateRuleEnabled = async (rule: NetworkAutoSwitchRule, enabled: boolean) => {
    await saveNetworkAutoSwitchRule({ ...rule, enabled });
  };

  const handleAutoSwitchToggle = (enabled: boolean) => {
    if (enabled && servers.length === 0) {
      Alert.alert(t('networkAutoSwitch.title'), t('networkAutoSwitch.needServer'), [
        { text: t('common.confirm') },
      ]);
      return;
    }
    void updateNetworkAutoSwitch({ enabled });
  };

  const handleNotificationModeChange = async (notificationMode: NetworkSwitchNotificationMode) => {
    await updateNetworkAutoSwitch({ notificationMode });
    if (notificationMode === 'system') {
      await requestNotificationPermission();
    }
  };

  const deleteRule = (rule: NetworkAutoSwitchRule) => {
    Alert.alert(
      t('networkAutoSwitch.deleteRule'),
      t('networkAutoSwitch.confirmDeleteRule', { name: rule.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => deleteNetworkAutoSwitchRule(rule.id),
        },
      ]
    );
  };

  const conditionSummary = (rule: NetworkAutoSwitchRule): string[] => {
    const typeLabels: Record<string, string> = {
      wifi: t('networkAutoSwitch.typeWifi'),
      cellular: t('networkAutoSwitch.typeCellular'),
      ethernet: t('networkAutoSwitch.typeEthernet'),
      vpn: t('networkAutoSwitch.typeVpn'),
      other: t('networkAutoSwitch.typeOther'),
    };
    const result: string[] = [];
    if (rule.networkTypes.length > 0) {
      result.push(
        t('networkAutoSwitch.conditionNetwork', {
          value: rule.networkTypes.map((type) => typeLabels[type]).join('、'),
        })
      );
    }
    if (rule.ssids.length > 0) {
      result.push(
        t('networkAutoSwitch.conditionWifi', {
          value:
            rule.ssids.length > 2 ? `${rule.ssids.slice(0, 2).join('、')}…` : rule.ssids.join('、'),
        })
      );
    }
    if (rule.ipRanges.length > 0) {
      result.push(
        t('networkAutoSwitch.conditionIp', {
          value:
            rule.ipRanges.length > 2
              ? `${rule.ipRanges.slice(0, 2).join('、')}…`
              : rule.ipRanges.join('、'),
        })
      );
    }
    return result;
  };

  const actionOptions: Array<{ value: NetworkNoMatchAction; label: string }> = [
    { value: 'keep', label: t('networkAutoSwitch.actionKeep') },
    { value: 'defaultServer', label: t('networkAutoSwitch.actionDefault') },
    { value: 'none', label: t('networkAutoSwitch.actionNone') },
  ];

  const notificationOptions: Array<{
    value: NetworkSwitchNotificationMode;
    label: string;
  }> = [
    { value: 'none', label: t('networkAutoSwitch.notificationNone') },
    { value: 'toast', label: t('networkAutoSwitch.notificationToast') },
    { value: 'system', label: t('networkAutoSwitch.notificationSystem') },
  ];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={[]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View
          testID="network-auto-status"
          style={[
            styles.card,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
          ]}
        >
          <SettingItem
            label={t('networkAutoSwitch.status')}
            description={
              evaluation?.hasUnavailableConditions
                ? `${statusText}\n${t('networkAutoSwitch.statusIncomplete')}`
                : statusText
            }
            descriptionLink={
              runtime.manualOverride
                ? {
                    text: t('networkAutoSwitch.restoreAuto'),
                    onPress: () => networkAutoSwitchService.clearManualOverride(),
                  }
                : undefined
            }
          >
            <TouchableOpacity testID="auto-switch-refresh" onPress={refresh} disabled={detecting}>
              {detecting ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : (
                <Text style={[styles.link, { color: theme.colors.primary }]}>
                  {t('networkAutoSwitch.refresh')}
                </Text>
              )}
            </TouchableOpacity>
          </SettingItem>
          <SettingItem
            label={t('networkAutoSwitch.currentNetwork')}
            description={
              snapshot
                ? `${snapshot.type}${
                    snapshot.type === 'wifi' && snapshot.ssid ? ` · ${snapshot.ssid}` : ''
                  }`
                : undefined
            }
            showBorder={false}
            onPress={() => navigation.navigate('CurrentNetwork')}
          >
            <ChevronRight color={theme.colors.textSecondary} width={20} height={20} />
          </SettingItem>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
          ]}
        >
          <SettingSwitch
            label={t('networkAutoSwitch.enabled')}
            description={
              servers.length === 0
                ? t('networkAutoSwitch.needServer')
                : t('networkAutoSwitch.enabledDescription')
            }
            value={autoSwitch.enabled}
            onChange={handleAutoSwitchToggle}
          />
          <SettingDropdown
            label={t('networkAutoSwitch.notify')}
            description={t('networkAutoSwitch.notifyDescription')}
            options={notificationOptions}
            value={autoSwitch.notificationMode}
            onChange={handleNotificationModeChange}
          />
          <SettingDropdown
            label={t('networkAutoSwitch.behavior')}
            options={actionOptions}
            value={autoSwitch.noMatchAction}
            onChange={(noMatchAction) => updateNetworkAutoSwitch({ noMatchAction })}
            showBorder={autoSwitch.noMatchAction === 'defaultServer'}
          />
          {autoSwitch.noMatchAction === 'defaultServer' && (
            <View style={styles.defaultServerField}>
              <Text style={[styles.description, { color: theme.colors.textSecondary }]}>
                {t('networkAutoSwitch.defaultServer')}
              </Text>
              <ServerSelect
                testID="default-server-select"
                servers={servers}
                selectedServerId={autoSwitch.defaultServerId}
                onSelect={(defaultServerId) => updateNetworkAutoSwitch({ defaultServerId })}
              />
            </View>
          )}
        </View>

        <View style={styles.ruleHeader}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
            {t('networkAutoSwitch.rules')}
          </Text>
          <TouchableOpacity
            testID="add-network-rule"
            accessibilityRole="button"
            accessibilityLabel={t('networkAutoSwitch.addRule')}
            style={styles.iconButton}
            onPress={() => navigation.navigate('NetworkRuleEditor')}
          >
            <Plus color={theme.colors.primary} width={20} height={20} />
          </TouchableOpacity>
        </View>

        {autoSwitch.rules.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
            ]}
          >
            <Text style={[styles.settingLabel, { color: theme.colors.text }]}>
              {t('networkAutoSwitch.noRules')}
            </Text>
            <Text style={[styles.description, { color: theme.colors.textTertiary }]}>
              {t('networkAutoSwitch.noRulesHint')}
            </Text>
          </View>
        ) : (
          autoSwitch.rules.map((rule, index) => {
            const targetMissing = !servers.some((server) => server.id === rule.targetServerId);
            return (
              <View key={rule.id}>
                <View
                  testID={`network-rule-${rule.id}`}
                  style={[
                    styles.ruleCard,
                    {
                      backgroundColor: theme.colors.surface,
                      borderColor: targetMissing ? theme.colors.error : theme.colors.divider,
                    },
                    !rule.enabled && styles.ruleDisabled,
                  ]}
                >
                  <View style={styles.ruleTitleRow}>
                    <View style={styles.ruleTitleArea}>
                      <Text style={[styles.ruleName, { color: theme.colors.text }]}>
                        {rule.name}
                      </Text>
                      <Text
                        style={[
                          styles.target,
                          { color: targetMissing ? theme.colors.error : theme.colors.primary },
                        ]}
                      >
                        {targetMissing
                          ? t('networkAutoSwitch.missingTarget')
                          : serverName(rule.targetServerId)}
                      </Text>
                    </View>
                    <ThemedSwitch
                      value={rule.enabled}
                      onValueChange={(enabled) => updateRuleEnabled(rule, enabled)}
                    />
                  </View>
                  {conditionSummary(rule).map((summary) => (
                    <Text
                      key={summary}
                      style={[styles.description, { color: theme.colors.textSecondary }]}
                    >
                      {summary}
                    </Text>
                  ))}
                  <View style={styles.actions}>
                    <View style={styles.actionGroup}>
                      <TouchableOpacity
                        disabled={index === 0}
                        accessibilityLabel={t('networkAutoSwitch.moveUp')}
                        onPress={() => moveNetworkAutoSwitchRule(rule.id, -1)}
                      >
                        <ChevronUp
                          color={index === 0 ? theme.colors.textDisabled : theme.colors.primary}
                          width={20}
                          height={20}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        disabled={index === autoSwitch.rules.length - 1}
                        accessibilityLabel={t('networkAutoSwitch.moveDown')}
                        onPress={() => moveNetworkAutoSwitchRule(rule.id, 1)}
                      >
                        <ChevronDown
                          color={
                            index === autoSwitch.rules.length - 1
                              ? theme.colors.textDisabled
                              : theme.colors.primary
                          }
                          width={20}
                          height={20}
                        />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.actionGroup}>
                      <TouchableOpacity
                        accessibilityLabel={t('common.edit')}
                        onPress={() =>
                          navigation.navigate('NetworkRuleEditor', { ruleId: rule.id })
                        }
                      >
                        <Edit3 color={theme.colors.primary} width={20} height={20} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        accessibilityLabel={t('common.delete')}
                        onPress={() => deleteRule(rule)}
                      >
                        <Trash2 color={theme.colors.error} width={18} height={18} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  card: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  settingLabel: { fontSize: 15, fontWeight: '600' },
  description: { fontSize: 13, lineHeight: 18 },
  sectionTitle: { fontSize: 14, fontWeight: '700' },
  link: { fontSize: 13, fontWeight: '600' },
  defaultServerField: { margin: 14, marginTop: 4, gap: 8 },
  ruleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyCard: { borderWidth: 1, borderRadius: 12, padding: 20, alignItems: 'center', gap: 6 },
  ruleCard: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 5 },
  ruleDisabled: { opacity: 0.58 },
  ruleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ruleTitleArea: { flex: 1 },
  ruleName: { fontSize: 16, fontWeight: '700' },
  target: { fontSize: 13, marginTop: 3 },
  actions: {
    minHeight: 38,
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
});
