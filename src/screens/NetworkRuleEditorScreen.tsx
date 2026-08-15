import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { StackScreenProps } from '@react-navigation/stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores/settingsStore';
import type { SettingsStackParamList } from '@/navigation/types';
import type {
  MobileNetworkType,
  NetworkAutoSwitchRule,
  NetworkRuleMatchMode,
} from '@/types/networkAutoSwitch';
import { currentNetworkService, type WifiPermissionState } from '@/services/CurrentNetworkService';
import { IpRuleError, normalizeIpRuleLine, normalizeIpRuleLines } from '@/utils/networkAutoSwitch';
import { ServerSelect } from '@/components';
import { ThemedSwitch } from '@/components/settings';

type Props = StackScreenProps<SettingsStackParamList, 'NetworkRuleEditor'>;

interface FormErrors {
  name?: string;
  target?: string;
  conditions?: string;
  networkTypes?: string;
  ssids?: string;
  ip?: string;
}

const NETWORK_TYPES: MobileNetworkType[] = ['wifi', 'cellular', 'ethernet', 'vpn', 'other'];

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export const NetworkRuleEditorScreen = ({ navigation, route }: Props) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { config, saveNetworkAutoSwitchRule } = useSettingsStore();

  const ipRuleErrorMessage = (reason: unknown): string => {
    if (!(reason instanceof IpRuleError)) {
      return reason instanceof Error ? reason.message : String(reason);
    }
    switch (reason.code) {
      case 'empty-address':
        return t('networkAutoSwitch.ipErrorEmpty');
      case 'invalid-cidr':
        return t('networkAutoSwitch.ipErrorCidr');
      case 'invalid-address':
        return t('networkAutoSwitch.ipErrorAddress');
      case 'unusable-address':
        return t('networkAutoSwitch.ipErrorUnusable');
      case 'invalid-prefix':
        return t('networkAutoSwitch.ipErrorPrefix', { max: reason.maxPrefix });
      case 'range-too-broad':
        return t('networkAutoSwitch.ipErrorRange');
    }
  };
  const rules = config?.networkAutoSwitch.rules ?? [];
  const sourceId = route.params?.duplicateFromId ?? route.params?.ruleId;
  const source = rules.find((rule) => rule.id === sourceId);
  const isDuplicate = !!route.params?.duplicateFromId;
  const initialRule = useMemo<NetworkAutoSwitchRule>(
    () => ({
      id: isDuplicate ? '' : (source?.id ?? ''),
      name: source
        ? isDuplicate
          ? `${source.name} (${t('networkAutoSwitch.copyRule')})`
          : source.name
        : '',
      enabled: source?.enabled ?? true,
      targetServerId: source?.targetServerId ?? config?.servers[0]?.id ?? '',
      networkTypes: source?.networkTypes ?? [],
      ssids: source?.ssids ?? [],
      ipRanges: source?.ipRanges ?? [],
      matchMode: source?.matchMode ?? 'all',
    }),
    [config?.servers, isDuplicate, source, t]
  );

  const [name, setName] = useState(initialRule.name);
  const [enabled, setEnabled] = useState(initialRule.enabled);
  const [targetServerId, setTargetServerId] = useState(initialRule.targetServerId);
  const [networkTypes, setNetworkTypes] = useState(initialRule.networkTypes);
  const [ssidsText, setSsidsText] = useState(initialRule.ssids.join('\n'));
  const [ipText, setIpText] = useState(initialRule.ipRanges.join('\n'));
  const [networkTypeEnabled, setNetworkTypeEnabled] = useState(initialRule.networkTypes.length > 0);
  const [ssidEnabled, setSsidEnabled] = useState(initialRule.ssids.length > 0);
  const [ipEnabled, setIpEnabled] = useState(initialRule.ipRanges.length > 0);
  const [matchMode, setMatchMode] = useState<NetworkRuleMatchMode>(initialRule.matchMode);
  const [errors, setErrors] = useState<FormErrors>({});
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [informationWarning, setInformationWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const allowExit = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const triggerSave = useCallback(() => {
    void saveRef.current();
  }, []);

  const currentValue = JSON.stringify({
    name,
    enabled,
    targetServerId,
    networkTypes,
    ssidsText,
    ipText,
    networkTypeEnabled,
    ssidEnabled,
    ipEnabled,
    matchMode,
  });
  const initialValue = useRef(
    JSON.stringify({
      name: initialRule.name,
      enabled: initialRule.enabled,
      targetServerId: initialRule.targetServerId,
      networkTypes: initialRule.networkTypes,
      ssidsText: initialRule.ssids.join('\n'),
      ipText: initialRule.ipRanges.join('\n'),
      networkTypeEnabled: initialRule.networkTypes.length > 0,
      ssidEnabled: initialRule.ssids.length > 0,
      ipEnabled: initialRule.ipRanges.length > 0,
      matchMode: initialRule.matchMode,
    })
  );

  useEffect(() => {
    return navigation.addListener('beforeRemove', (event) => {
      if (allowExit.current || currentValue === initialValue.current) return;
      event.preventDefault();
      Alert.alert(t('networkAutoSwitch.unsavedTitle'), t('networkAutoSwitch.unsavedMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('networkAutoSwitch.discard'),
          style: 'destructive',
          onPress: () => {
            allowExit.current = true;
            navigation.dispatch(event.data.action);
          },
        },
        {
          text: t('networkAutoSwitch.saveRule'),
          onPress: triggerSave,
        },
      ]);
    });
  }, [currentValue, navigation, t, triggerSave]);

  const typeLabel = (type: MobileNetworkType): string => {
    const labels: Record<MobileNetworkType, string> = {
      wifi: t('networkAutoSwitch.typeWifi'),
      cellular: t('networkAutoSwitch.typeCellular'),
      ethernet: t('networkAutoSwitch.typeEthernet'),
      vpn: t('networkAutoSwitch.typeVpn'),
      other: t('networkAutoSwitch.typeOther'),
    };
    return labels[type];
  };

  const toggleType = (type: MobileNetworkType) => {
    setNetworkTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type]
    );
  };

  const activeConditionCount = [networkTypeEnabled, ssidEnabled, ipEnabled].filter(Boolean).length;

  const setConditionEnabled = (condition: 'networkTypes' | 'ssids' | 'ip', value: boolean) => {
    setErrors((current) => ({ ...current, conditions: undefined, [condition]: undefined }));
    if (condition === 'networkTypes') setNetworkTypeEnabled(value);
    if (condition === 'ssids') setSsidEnabled(value);
    if (condition === 'ip') setIpEnabled(value);
  };

  const formatPreviewValues = (values: string[]): string => {
    const separator = t('networkAutoSwitch.valueSeparator');
    if (values.length <= 2) return values.join(separator);
    return t('networkAutoSwitch.previewMore', {
      values: values.slice(0, 2).join(separator),
      count: values.length - 2,
    });
  };

  const previewConditions: string[] = [];
  if (networkTypeEnabled && networkTypes.length > 0) {
    previewConditions.push(
      t('networkAutoSwitch.previewNetworkType', {
        value: formatPreviewValues(networkTypes.map(typeLabel)),
      })
    );
  }
  const previewSsids = splitLines(ssidsText);
  if (ssidEnabled && previewSsids.length > 0) {
    previewConditions.push(
      t('networkAutoSwitch.previewSsid', { value: formatPreviewValues(previewSsids) })
    );
  }
  const previewIps = splitLines(ipText);
  if (ipEnabled && previewIps.length > 0) {
    previewConditions.push(
      t('networkAutoSwitch.previewIp', { value: formatPreviewValues(previewIps) })
    );
  }
  const selectedServer = config?.servers.find((item) => item.id === targetServerId);
  const previewServer =
    selectedServer?.name || selectedServer?.url || t('networkAutoSwitch.selectServerPlaceholder');

  const requestWifiPermission = async (): Promise<WifiPermissionState> => {
    const current = await currentNetworkService.getWifiPermissionState();
    if (current === 'granted') return current;
    return new Promise((resolve) => {
      Alert.alert(
        t('networkAutoSwitch.wifiPermissionTitle'),
        t('networkAutoSwitch.wifiPermissionMessage'),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(current) },
          {
            text: t('common.confirm'),
            onPress: async () => resolve(await currentNetworkService.requestWifiPermission()),
          },
        ]
      );
    });
  };

  const useCurrentWifi = async () => {
    const permission = await requestWifiPermission();
    if (permission !== 'granted') {
      setPermissionMessage(
        permission === 'blocked'
          ? t('networkAutoSwitch.wifiPermissionBlocked')
          : t('networkAutoSwitch.wifiPermissionDenied')
      );
      return;
    }
    const snapshot = await currentNetworkService.getSnapshot();
    if (!snapshot.ssid) {
      setPermissionMessage(t('networkAutoSwitch.ssidUnavailable'));
      return;
    }
    const existing = splitLines(ssidsText);
    if (!existing.includes(snapshot.ssid)) setSsidsText([...existing, snapshot.ssid].join('\n'));
    setErrors((current) => ({ ...current, ssids: undefined }));
    setPermissionMessage(null);
  };

  const useCurrentIp = async () => {
    const snapshot = await currentNetworkService.getSnapshot();
    const existing = splitLines(ipText);
    const existingKeys = new Set(
      existing.map((line) => {
        try {
          const parsed = normalizeIpRuleLine(line);
          return `${parsed.family}:${parsed.address}/${parsed.prefixLength}`;
        } catch {
          return line;
        }
      })
    );
    const additions = snapshot.ipAddresses.filter((address) => {
      const parsed = normalizeIpRuleLine(address);
      const key = `${parsed.family}:${parsed.address}/${parsed.prefixLength}`;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    setIpText([...existing, ...additions].join('\n'));
    setErrors((current) => ({ ...current, ip: undefined }));
    setInformationWarning(snapshot.unavailableReasons.length > 0);
  };

  const validate = (): { rule?: NetworkAutoSwitchRule; errors: FormErrors } => {
    const nextErrors: FormErrors = {};
    const ssids = ssidEnabled ? splitLines(ssidsText) : [];
    const rawIps = ipEnabled ? splitLines(ipText) : [];
    const savedNetworkTypes = networkTypeEnabled ? networkTypes : [];
    let ipRanges: string[] = [];
    if (!name.trim()) nextErrors.name = t('networkAutoSwitch.nameRequired');
    if (!config?.servers.some((server) => server.id === targetServerId)) {
      nextErrors.target = t('networkAutoSwitch.targetRequired');
    }
    if (activeConditionCount === 0) {
      nextErrors.conditions = t('networkAutoSwitch.conditionRequired');
    }
    if (networkTypeEnabled && savedNetworkTypes.length === 0) {
      nextErrors.networkTypes = t('networkAutoSwitch.networkTypeRequired');
    }
    if (ssidEnabled && ssids.length === 0) {
      nextErrors.ssids = t('networkAutoSwitch.ssidRequired');
    }
    if (ipEnabled && rawIps.length === 0) {
      nextErrors.ip = t('networkAutoSwitch.ipRequired');
    } else if (ipEnabled) {
      for (let index = 0; index < rawIps.length; index += 1) {
        try {
          normalizeIpRuleLine(rawIps[index]);
        } catch (reason) {
          nextErrors.ip = t('networkAutoSwitch.invalidIpLine', {
            line: index + 1,
            message: ipRuleErrorMessage(reason),
          });
          break;
        }
      }
    }
    if (ipEnabled && !nextErrors.ip) ipRanges = normalizeIpRuleLines(rawIps);
    if (Object.keys(nextErrors).length > 0) return { errors: nextErrors };
    return {
      errors: nextErrors,
      rule: {
        id: initialRule.id,
        name: name.trim(),
        enabled,
        targetServerId,
        networkTypes: savedNetworkTypes,
        ssids: Array.from(new Set(ssids)),
        ipRanges,
        matchMode: activeConditionCount > 1 ? matchMode : 'all',
      },
    };
  };

  const save = async () => {
    const result = validate();
    setErrors(result.errors);
    if (!result.rule) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    setSaving(true);
    try {
      await saveNetworkAutoSwitchRule(result.rule);
      allowExit.current = true;
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = save;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('networkAutoSwitch.saveRule')}
          disabled={saving}
          style={styles.headerSaveButton}
          onPress={triggerSave}
        >
          <Text
            style={[
              styles.headerSaveText,
              { color: theme.colors.primary },
              saving && styles.saving,
            ]}
          >
            {t('networkAutoSwitch.saveRule')}
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, saving, t, theme.colors.primary, triggerSave]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={[]}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.card,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
          ]}
        >
          <Text style={[styles.label, { color: theme.colors.text }]}>
            {t('networkAutoSwitch.ruleName')}
          </Text>
          <TextInput
            testID="network-rule-name"
            value={name}
            onChangeText={setName}
            placeholder={t('networkAutoSwitch.ruleNamePlaceholder')}
            placeholderTextColor={theme.colors.textTertiary}
            style={[
              styles.input,
              {
                color: theme.colors.text,
                borderColor: errors.name ? theme.colors.error : theme.colors.divider,
              },
            ]}
          />
          {errors.name && (
            <Text style={[styles.error, { color: theme.colors.error }]}>{errors.name}</Text>
          )}
          <View style={styles.switchRow}>
            <Text style={[styles.label, { color: theme.colors.text }]}>
              {t('networkAutoSwitch.ruleEnabled')}
            </Text>
            <ThemedSwitch value={enabled} onValueChange={setEnabled} />
          </View>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
          ]}
        >
          <Text style={[styles.label, { color: theme.colors.text }]}>
            {t('networkAutoSwitch.targetServer')}
          </Text>
          <ServerSelect
            testID="target-server-select"
            servers={config?.servers ?? []}
            selectedServerId={targetServerId}
            hasError={!!errors.target}
            onSelect={(serverId) => {
              setTargetServerId(serverId);
              setErrors((current) => ({ ...current, target: undefined }));
            }}
          />
          {errors.target && (
            <Text style={[styles.error, { color: theme.colors.error }]}>{errors.target}</Text>
          )}
        </View>

        <View style={styles.conditionSectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
            {t('networkAutoSwitch.matchConditions')}
          </Text>
          <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>
            {t('networkAutoSwitch.matchConditionsHint')}
          </Text>
          {errors.conditions && (
            <Text style={[styles.error, { color: theme.colors.error }]}>{errors.conditions}</Text>
          )}
        </View>

        <View
          style={[
            styles.conditionCard,
            {
              backgroundColor: theme.colors.surface,
              borderColor: errors.networkTypes ? theme.colors.error : theme.colors.divider,
            },
          ]}
        >
          <View style={styles.conditionHeader}>
            <View style={styles.conditionTitleArea}>
              <Text style={[styles.label, { color: theme.colors.text }]}>
                {t('networkAutoSwitch.networkType')}
              </Text>
              <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>
                {networkTypeEnabled
                  ? networkTypes.length > 0
                    ? t('networkAutoSwitch.conditionConfigured', { count: networkTypes.length })
                    : t('networkAutoSwitch.conditionNeedsValue')
                  : t('networkAutoSwitch.conditionDisabled')}
              </Text>
            </View>
            <ThemedSwitch
              testID="network-type-condition-switch"
              value={networkTypeEnabled}
              onValueChange={(value) => setConditionEnabled('networkTypes', value)}
            />
          </View>
          {networkTypeEnabled && (
            <View style={[styles.conditionBody, { borderTopColor: theme.colors.divider }]}>
              <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>
                {t('networkAutoSwitch.networkTypeHint')}
              </Text>
              <View style={styles.chips}>
                {NETWORK_TYPES.map((type) => {
                  const selected = networkTypes.includes(type);
                  return (
                    <TouchableOpacity
                      key={type}
                      testID={`network-type-${type}`}
                      accessibilityRole="checkbox"
                      accessibilityLabel={typeLabel(type)}
                      accessibilityState={{ checked: selected }}
                      style={[
                        styles.chip,
                        {
                          borderColor: selected ? theme.colors.primary : theme.colors.divider,
                          backgroundColor: selected
                            ? `${theme.colors.primary}18`
                            : theme.colors.background,
                        },
                      ]}
                      onPress={() => {
                        toggleType(type);
                        setErrors((current) => ({ ...current, networkTypes: undefined }));
                      }}
                    >
                      <Text style={{ color: selected ? theme.colors.primary : theme.colors.text }}>
                        {typeLabel(type)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {errors.networkTypes && (
                <Text style={[styles.error, { color: theme.colors.error }]}>
                  {errors.networkTypes}
                </Text>
              )}
            </View>
          )}
        </View>

        <View
          style={[
            styles.conditionCard,
            {
              backgroundColor: theme.colors.surface,
              borderColor: errors.ssids ? theme.colors.error : theme.colors.divider,
            },
          ]}
        >
          <View style={styles.conditionHeader}>
            <View style={styles.conditionTitleArea}>
              <Text style={[styles.label, { color: theme.colors.text }]}>
                {t('networkAutoSwitch.ssids')}
              </Text>
              <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>
                {ssidEnabled
                  ? splitLines(ssidsText).length > 0
                    ? t('networkAutoSwitch.conditionConfigured', {
                        count: splitLines(ssidsText).length,
                      })
                    : t('networkAutoSwitch.conditionNeedsValue')
                  : t('networkAutoSwitch.conditionDisabled')}
              </Text>
            </View>
            <ThemedSwitch
              testID="ssid-condition-switch"
              value={ssidEnabled}
              onValueChange={(value) => setConditionEnabled('ssids', value)}
            />
          </View>
          {ssidEnabled && (
            <View style={[styles.conditionBody, { borderTopColor: theme.colors.divider }]}>
              <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>
                {t('networkAutoSwitch.ssidsHint')}
              </Text>
              <TextInput
                testID="network-rule-ssids"
                multiline
                value={ssidsText}
                onChangeText={(value) => {
                  setSsidsText(value);
                  setErrors((current) => ({ ...current, ssids: undefined }));
                }}
                placeholder={t('networkAutoSwitch.ssidsPlaceholder')}
                placeholderTextColor={theme.colors.textTertiary}
                style={[
                  styles.multiline,
                  {
                    color: theme.colors.text,
                    borderColor: errors.ssids ? theme.colors.error : theme.colors.divider,
                  },
                ]}
              />
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: theme.colors.primary }]}
                onPress={useCurrentWifi}
              >
                <Text style={[styles.secondaryButtonText, { color: theme.colors.primary }]}>
                  {t('networkAutoSwitch.useCurrentWifi')}
                </Text>
              </TouchableOpacity>
              {errors.ssids && (
                <Text style={[styles.error, { color: theme.colors.error }]}>{errors.ssids}</Text>
              )}
              {permissionMessage && (
                <Text style={[styles.error, { color: theme.colors.warning }]}>
                  {permissionMessage}
                </Text>
              )}
              {permissionMessage === t('networkAutoSwitch.wifiPermissionBlocked') && (
                <TouchableOpacity onPress={currentNetworkService.openSystemSettings}>
                  <Text style={[styles.link, { color: theme.colors.primary }]}>
                    {t('networkAutoSwitch.openSettings')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        <View
          style={[
            styles.conditionCard,
            {
              backgroundColor: theme.colors.surface,
              borderColor: errors.ip ? theme.colors.error : theme.colors.divider,
            },
          ]}
        >
          <View style={styles.conditionHeader}>
            <View style={styles.conditionTitleArea}>
              <Text style={[styles.label, { color: theme.colors.text }]}>
                {t('networkAutoSwitch.ipRanges')}
              </Text>
              <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>
                {ipEnabled
                  ? splitLines(ipText).length > 0
                    ? t('networkAutoSwitch.conditionConfigured', {
                        count: splitLines(ipText).length,
                      })
                    : t('networkAutoSwitch.conditionNeedsValue')
                  : t('networkAutoSwitch.conditionDisabled')}
              </Text>
            </View>
            <ThemedSwitch
              testID="ip-condition-switch"
              value={ipEnabled}
              onValueChange={(value) => setConditionEnabled('ip', value)}
            />
          </View>
          {ipEnabled && (
            <View style={[styles.conditionBody, { borderTopColor: theme.colors.divider }]}>
              <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>
                {t('networkAutoSwitch.ipRangesHint')}
              </Text>
              <TextInput
                testID="network-rule-ips"
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                value={ipText}
                onChangeText={(value) => {
                  setIpText(value);
                  setErrors((current) => ({ ...current, ip: undefined }));
                }}
                placeholder={t('networkAutoSwitch.ipRangesPlaceholder')}
                placeholderTextColor={theme.colors.textTertiary}
                style={[
                  styles.multiline,
                  {
                    color: theme.colors.text,
                    borderColor: errors.ip ? theme.colors.error : theme.colors.divider,
                  },
                ]}
              />
              <TouchableOpacity
                style={[styles.secondaryButton, { borderColor: theme.colors.primary }]}
                onPress={useCurrentIp}
              >
                <Text style={[styles.secondaryButtonText, { color: theme.colors.primary }]}>
                  {t('networkAutoSwitch.useCurrentIp')}
                </Text>
              </TouchableOpacity>
              {errors.ip && (
                <Text style={[styles.error, { color: theme.colors.error }]}>{errors.ip}</Text>
              )}
            </View>
          )}
        </View>

        {activeConditionCount > 1 && (
          <View
            style={[
              styles.card,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
            ]}
          >
            <Text style={[styles.label, { color: theme.colors.text }]}>
              {t('networkAutoSwitch.matchMode')}
            </Text>
            {(['all', 'any'] as NetworkRuleMatchMode[]).map((mode) => (
              <TouchableOpacity
                key={mode}
                accessibilityRole="radio"
                accessibilityLabel={t(
                  mode === 'all' ? 'networkAutoSwitch.matchAll' : 'networkAutoSwitch.matchAny'
                )}
                accessibilityState={{ checked: matchMode === mode }}
                style={styles.radioRow}
                onPress={() => setMatchMode(mode)}
              >
                <View
                  style={[
                    styles.radio,
                    {
                      borderColor: matchMode === mode ? theme.colors.primary : theme.colors.divider,
                    },
                  ]}
                >
                  {matchMode === mode && (
                    <View style={[styles.radioDot, { backgroundColor: theme.colors.primary }]} />
                  )}
                </View>
                <Text style={[styles.choiceText, { color: theme.colors.text }]}>
                  {t(mode === 'all' ? 'networkAutoSwitch.matchAll' : 'networkAutoSwitch.matchAny')}
                </Text>
              </TouchableOpacity>
            ))}
            {informationWarning && matchMode === 'all' && (
              <Text style={[styles.error, { color: theme.colors.warning }]}>
                {t('networkAutoSwitch.unavailableAllWarning')}
              </Text>
            )}
          </View>
        )}

        <View
          testID="network-rule-preview"
          style={[
            styles.previewCard,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
          ]}
        >
          <Text style={[styles.label, { color: theme.colors.text }]}>
            {t('networkAutoSwitch.matchPreview')}
          </Text>
          {previewConditions.length === 0 ? (
            <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>
              {t('networkAutoSwitch.previewEmpty')}
            </Text>
          ) : (
            <>
              {previewConditions.map((condition, index) => (
                <View key={`${index}-${condition}`} style={styles.previewRow}>
                  <Text style={[styles.previewConnector, { color: theme.colors.primary }]}>
                    {index === 0
                      ? t('networkAutoSwitch.previewWhen')
                      : t(
                          matchMode === 'all'
                            ? 'networkAutoSwitch.previewAnd'
                            : 'networkAutoSwitch.previewOr'
                        )}
                  </Text>
                  <Text style={[styles.previewText, { color: theme.colors.text }]}>
                    {condition}
                  </Text>
                </View>
              ))}
              <View style={[styles.previewTargetRow, { borderTopColor: theme.colors.divider }]}>
                <Text style={[styles.previewArrow, { color: theme.colors.primary }]}>→</Text>
                <Text style={[styles.previewTarget, { color: theme.colors.text }]}>
                  {t('networkAutoSwitch.previewTarget', { server: previewServer })}
                </Text>
              </View>
            </>
          )}
        </View>

        <TouchableOpacity
          testID="save-network-rule"
          accessibilityRole="button"
          style={[
            styles.saveButton,
            { backgroundColor: theme.colors.primary },
            saving && styles.saving,
          ]}
          onPress={triggerSave}
          disabled={saving}
        >
          <Text style={[styles.saveText, { color: theme.colors.white }]}>
            {t('networkAutoSwitch.saveRule')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  conditionSectionHeader: { gap: 4, marginTop: 2 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  conditionCard: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  conditionHeader: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  conditionTitleArea: { flex: 1, gap: 3 },
  conditionBody: { borderTopWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  label: { fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 13, lineHeight: 18 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, fontSize: 16 },
  multiline: {
    minHeight: 104,
    borderWidth: 1,
    borderRadius: 9,
    padding: 12,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  choiceText: { fontSize: 15, flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 40,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderRadius: 20,
    justifyContent: 'center',
  },
  secondaryButton: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: { fontSize: 14, fontWeight: '600' },
  radioRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 12, height: 12, borderRadius: 6 },
  error: { fontSize: 13, lineHeight: 18 },
  link: { fontSize: 14, fontWeight: '600' },
  previewCard: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  previewRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  previewConnector: { width: 36, fontSize: 14, fontWeight: '700', lineHeight: 21 },
  previewText: { flex: 1, fontSize: 14, lineHeight: 21 },
  previewTargetRow: {
    marginTop: 2,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  previewArrow: { width: 36, fontSize: 20, fontWeight: '700' },
  previewTarget: { flex: 1, fontSize: 15, fontWeight: '700' },
  saveButton: { minHeight: 50, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  saving: { opacity: 0.6 },
  saveText: { fontSize: 16, fontWeight: '700' },
  headerSaveButton: {
    minWidth: 60,
    minHeight: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSaveText: { fontSize: 16, fontWeight: '600' },
});
