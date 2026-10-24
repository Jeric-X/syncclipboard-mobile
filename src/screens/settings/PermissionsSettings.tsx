import { SettingsSection, SettingSwitch } from '@/components/settings';
import { useTheme } from '@/hooks/useTheme';
import { currentNetworkService, type WifiPermissionState } from '@/services/CurrentNetworkService';
import {
  hasNotificationPermission,
  requestNotificationPermission,
} from '@/utils/notificationPermission';
import { useFocusEffect } from '@react-navigation/native';
import { hasOverlayPermission, requestOverlayPermission } from 'clipboard-overlay';
import { isIgnoringBatteryOptimizations, requestIgnoreBatteryOptimizations } from 'native-util';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  AppState,
  Linking,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { RefreshCw } from 'react-native-feather';
import {
  hasShizukuPermission,
  isShizukuAvailable,
  requestShizukuPermission,
} from 'shizuku-clipboard';

/** 系统权限状态、申请操作和返回前台后的刷新。 */
export const PermissionsSettings = () => {
  const { theme } = useTheme();

  const { t } = useTranslation();

  // 刷新权限状态
  const refreshPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    setIsRefreshingPermissions(true);
    try {
      const [notif, sms, wifiLocation, wifiBackgroundLocation] = await Promise.all([
        hasNotificationPermission(),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
        currentNetworkService.getFineLocationPermissionState(),
        currentNetworkService.getBackgroundLocationPermissionState(),
      ]);
      setPermNotification(notif);
      setPermOverlay(hasOverlayPermission());
      setPermSms(sms);
      setPermWifiLocation(wifiLocation === 'granted');
      setPermWifiBackgroundLocation(
        wifiBackgroundLocation === 'granted' || wifiBackgroundLocation === 'unavailable'
      );
      setLocationServicesEnabled(currentNetworkService.isLocationServicesEnabled());
      setPermBattery(isIgnoringBatteryOptimizations());
      const shizukuUp = isShizukuAvailable();
      setShizukuAvailable(shizukuUp);
      setPermShizuku(shizukuUp && hasShizukuPermission());
    } catch (e) {
      console.warn('[Settings] Failed to check permissions:', e);
    } finally {
      setIsRefreshingPermissions(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshPermissions();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refreshPermissions();
      });
      return () => subscription.remove();
    }, [refreshPermissions])
  );

  // 权限状态
  const [permNotification, setPermNotification] = useState<boolean>(false);

  const [permOverlay, setPermOverlay] = useState<boolean>(false);

  const [permSms, setPermSms] = useState<boolean>(false);

  const [permWifiLocation, setPermWifiLocation] = useState<boolean>(false);

  const [permWifiBackgroundLocation, setPermWifiBackgroundLocation] = useState<boolean>(false);

  const [locationServicesEnabled, setLocationServicesEnabled] = useState<boolean>(false);

  const [permBattery, setPermBattery] = useState<boolean>(false);

  const [permShizuku, setPermShizuku] = useState<boolean>(false);

  const [shizukuAvailable, setShizukuAvailable] = useState<boolean>(false);

  const [isRefreshingPermissions, setIsRefreshingPermissions] = useState<boolean>(false);

  const hasBatteryOptRequested = useRef<boolean>(false);

  const handleNetworkPermissionResult = (
    result: WifiPermissionState,
    update: (granted: boolean) => void
  ) => {
    update(result === 'granted' || result === 'unavailable');
    if (result === 'blocked') {
      Alert.alert(
        t('settings.permissionWifiBlockedTitle'),
        t('settings.permissionWifiBlockedMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.goToSettings'), onPress: currentNetworkService.openSystemSettings },
        ]
      );
    }
  };
  return (
    <SettingsSection
      title={t('settings.permissionsSection')}
      headerRight={
        <TouchableOpacity
          style={styles.iconButton}
          onPress={refreshPermissions}
          disabled={isRefreshingPermissions}
        >
          <RefreshCw color={theme.colors.primary} width={16} height={16} />
        </TouchableOpacity>
      }
    >
      <SettingSwitch
        label={t('settings.permissionNotification')}
        value={permNotification}
        onChange={async () => {
          if (permNotification) {
            await Linking.openSettings();
            return;
          }
          const granted = await requestNotificationPermission({ showFailureAlert: false });
          setPermNotification(granted);
          if (!granted) {
            await Linking.openSettings();
          }
        }}
      />

      <SettingSwitch
        label={t('settings.permissionWifiLocation')}
        description={t('settings.permissionWifiLocationDesc')}
        value={permWifiLocation}
        onChange={async () => {
          if (permWifiLocation) {
            await currentNetworkService.openSystemSettings();
            return;
          }
          handleNetworkPermissionResult(
            await currentNetworkService.requestFineLocationPermission(),
            setPermWifiLocation
          );
        }}
      />

      {Number(Platform.Version) >= 29 && (
        <SettingSwitch
          label={t('settings.permissionWifiBackgroundLocation')}
          description={t('settings.permissionWifiBackgroundLocationDesc')}
          value={permWifiBackgroundLocation}
          onChange={async () => {
            if (permWifiBackgroundLocation) {
              await currentNetworkService.openSystemSettings();
              return;
            }

            if (!permWifiLocation) {
              const fineResult = await currentNetworkService.requestFineLocationPermission();
              handleNetworkPermissionResult(fineResult, setPermWifiLocation);
              if (fineResult !== 'granted') return;
            }

            Alert.alert(
              t('settings.permissionWifiBackgroundLocationTitle'),
              t('settings.permissionWifiBackgroundLocationMessage'),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text:
                    Number(Platform.Version) >= 30 ? t('common.goToSettings') : t('common.confirm'),
                  onPress: async () => {
                    if (Number(Platform.Version) >= 30) {
                      await currentNetworkService.openSystemSettings();
                      return;
                    }
                    handleNetworkPermissionResult(
                      await currentNetworkService.requestBackgroundLocationPermission(),
                      setPermWifiBackgroundLocation
                    );
                  },
                },
              ]
            );
          }}
        />
      )}

      <SettingSwitch
        label={t('settings.locationServices')}
        description={t('settings.locationServicesDesc')}
        value={locationServicesEnabled}
        onChange={currentNetworkService.openLocationSettings}
      />

      <SettingSwitch
        label={t('settings.permissionOverlay')}
        description={t('settings.permissionOverlayDesc')}
        value={permOverlay}
        onChange={() => requestOverlayPermission()}
      />

      <SettingSwitch
        label={t('settings.permissionSms')}
        description={t('settings.permissionSmsDesc')}
        value={permSms}
        onChange={() => Linking.openSettings()}
      />

      <SettingSwitch
        label={t('settings.permissionShizuku')}
        description={
          shizukuAvailable
            ? t('settings.permissionShizukuDesc')
            : t('settings.shizukuNotRunningDesc')
        }
        value={permShizuku}
        onChange={async () => {
          if (!shizukuAvailable) {
            Alert.alert(
              t('settings.shizukuNotRunningTitle'),
              t('settings.shizukuNotRunningMessage'),
              [
                {
                  text: t('common.learnMore'),
                  onPress: () => Linking.openURL('https://shizuku.rikka.app/guide/setup/'),
                },
                { text: t('common.cancel'), style: 'cancel' },
              ]
            );
            return;
          }
          if (!permShizuku) {
            requestShizukuPermission();
            setTimeout(refreshPermissions, 2000);
          }
        }}
      />

      <SettingSwitch
        label={t('settings.permissionBattery')}
        description={t('settings.permissionBatteryDesc')}
        value={permBattery}
        onChange={async () => {
          if (hasBatteryOptRequested.current) {
            Alert.alert(
              t('settings.batteryOptDialogTitle'),
              t('settings.batteryOptDialogMessage'),
              [
                {
                  text: t('common.goToSettings'),
                  onPress: () => Linking.openSettings(),
                },
                { text: t('common.cancel'), style: 'cancel' },
              ]
            );
            return;
          }
          requestIgnoreBatteryOptimizations();
          hasBatteryOptRequested.current = true;
        }}
      />
    </SettingsSection>
  );
};

const styles = StyleSheet.create({
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
