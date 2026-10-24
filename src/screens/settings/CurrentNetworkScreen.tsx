import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Copy } from 'react-native-feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { currentNetworkService, type WifiPermissionState } from '@/services/CurrentNetworkService';
import type { MobileNetworkSnapshot } from '@/types/networkAutoSwitch';

export const CurrentNetworkScreen = () => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<MobileNetworkSnapshot | null>(null);
  const [permission, setPermission] = useState<WifiPermissionState>('unavailable');
  const [locationServicesEnabled, setLocationServicesEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    setError(null);
    try {
      const [nextSnapshot, nextPermission] = await Promise.all([
        currentNetworkService.getSnapshot(),
        currentNetworkService.getWifiPermissionState(),
      ]);
      setSnapshot(nextSnapshot);
      setPermission(nextPermission);
      setLocationServicesEnabled(currentNetworkService.isLocationServicesEnabled());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    loadSnapshot();
    const unsubscribe = currentNetworkService.subscribe(loadSnapshot);
    return unsubscribe;
  }, [loadSnapshot]);

  const requestPermission = () => {
    Alert.alert(
      t('networkAutoSwitch.wifiPermissionTitle'),
      t('networkAutoSwitch.wifiPermissionMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: async () => {
            const result = await currentNetworkService.requestWifiPermission();
            setPermission(result);
            await loadSnapshot();
          },
        },
      ]
    );
  };

  const copyValue = async (value: string) => {
    await Clipboard.setStringAsync(value);
    Alert.alert(t('networkAutoSwitch.copied'));
  };

  const networkTypeLabel = (type: MobileNetworkSnapshot['type']) => {
    const labels = {
      wifi: t('networkAutoSwitch.typeWifi'),
      cellular: t('networkAutoSwitch.typeCellular'),
      ethernet: t('networkAutoSwitch.typeEthernet'),
      vpn: t('networkAutoSwitch.typeVpn'),
      other: t('networkAutoSwitch.typeOther'),
      none: t('networkAutoSwitch.unknown'),
      unknown: t('networkAutoSwitch.unknown'),
    };
    return labels[type];
  };

  const Row = ({ label, value, copy }: { label: string; value: string; copy?: boolean }) => (
    <View style={[styles.row, { borderBottomColor: theme.colors.divider }]}>
      <Text style={[styles.label, { color: theme.colors.textSecondary }]}>{label}</Text>
      <View style={styles.valueArea}>
        <Text selectable style={[styles.value, { color: theme.colors.text }]}>
          {value}
        </Text>
        {copy && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${t('networkAutoSwitch.copied')} ${value}`}
            onPress={() => copyValue(value)}
          >
            <Copy color={theme.colors.primary} width={18} height={18} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const ssidValue = () => {
    if (permission !== 'granted') return t('networkAutoSwitch.ssidPermissionRequired');
    if (!locationServicesEnabled) return t('networkAutoSwitch.locationServicesRequired');
    return snapshot?.ssid || t('networkAutoSwitch.ssidUnavailable');
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={[]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        {error && (
          <Text style={[styles.error, { color: theme.colors.error }]}>
            {t('networkAutoSwitch.loadingFailed', { message: error })}
          </Text>
        )}

        {snapshot && (
          <View
            testID="current-network-card"
            style={[
              styles.card,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
            ]}
          >
            <Row
              label={t('networkAutoSwitch.connection')}
              value={
                snapshot.isConnected
                  ? `${t('networkAutoSwitch.connected')} · ${networkTypeLabel(snapshot.type)}`
                  : t('networkAutoSwitch.disconnected')
              }
            />
            <Row
              label={t('networkAutoSwitch.internet')}
              value={
                snapshot.isInternetReachable === null
                  ? t('networkAutoSwitch.unknown')
                  : snapshot.isInternetReachable
                    ? t('networkAutoSwitch.reachable')
                    : t('networkAutoSwitch.unreachable')
              }
            />
            {snapshot.type === 'wifi' && (
              <Row label={t('networkAutoSwitch.ssid')} value={ssidValue()} copy={!!snapshot.ssid} />
            )}
            <View style={[styles.row, { borderBottomColor: theme.colors.divider }]}>
              <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
                {t('networkAutoSwitch.ipAddresses')}
              </Text>
              <View style={styles.ipList}>
                {snapshot.ipAddresses.length > 0 ? (
                  snapshot.ipAddresses.map((address) => (
                    <TouchableOpacity
                      key={address}
                      style={styles.ipRow}
                      accessibilityRole="button"
                      accessibilityLabel={address}
                      onPress={() => copyValue(address)}
                    >
                      <Text selectable style={[styles.value, { color: theme.colors.text }]}>
                        {address}
                      </Text>
                      <Copy color={theme.colors.primary} width={16} height={16} />
                    </TouchableOpacity>
                  ))
                ) : (
                  <Text style={[styles.value, { color: theme.colors.textTertiary }]}>
                    {t('networkAutoSwitch.ipUnavailable')}
                  </Text>
                )}
              </View>
            </View>
            <Row
              label={t('networkAutoSwitch.capturedAt')}
              value={new Date(snapshot.capturedAt).toLocaleTimeString()}
            />
          </View>
        )}

        {(permission !== 'granted' || !locationServicesEnabled) && (
          <TouchableOpacity
            testID="wifi-permission-button"
            style={[styles.primaryButton, { backgroundColor: theme.colors.primary }]}
            onPress={
              !locationServicesEnabled
                ? currentNetworkService.openLocationSettings
                : permission === 'blocked'
                  ? currentNetworkService.openSystemSettings
                  : requestPermission
            }
          >
            <Text style={[styles.primaryButtonText, { color: theme.colors.white }]}>
              {!locationServicesEnabled
                ? t('networkAutoSwitch.openLocationSettings')
                : permission === 'blocked'
                  ? t('networkAutoSwitch.openSettings')
                  : t('networkAutoSwitch.useCurrentWifi')}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 36 },
  card: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  row: {
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: { fontSize: 14, flexShrink: 0 },
  valueArea: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  value: { fontSize: 14, textAlign: 'right' },
  ipList: { flex: 1, gap: 8 },
  ipRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  primaryButton: { marginTop: 16, minHeight: 48, borderRadius: 10, justifyContent: 'center' },
  primaryButtonText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  error: { fontSize: 14, marginBottom: 12 },
});
