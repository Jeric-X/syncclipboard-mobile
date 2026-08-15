import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';
import i18n from '@/i18n';

export interface NotificationPermissionDependencies {
  isRuntimePermissionRequired(): boolean;
  hasPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  showRequestFailed(): void;
}

export interface NotificationPermissionOptions {
  showFailureAlert?: boolean;
}

const productionDependencies: NotificationPermissionDependencies = {
  isRuntimePermissionRequired: () => Platform.OS === 'android' && Number(Platform.Version) >= 33,
  hasPermission: () => PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS),
  requestPermission: async () =>
    (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)) ===
    PermissionsAndroid.RESULTS.GRANTED,
  showRequestFailed: () => {
    Alert.alert(
      i18n.t('settings.permissionRequestFailed'),
      i18n.t('settings.notificationPermissionRequestFailed'),
      [
        { text: i18n.t('common.later'), style: 'cancel' },
        { text: i18n.t('common.goToSettings'), onPress: () => Linking.openSettings() },
      ]
    );
  },
};

/** 检查通知运行时权限；无需运行时授权的平台和系统版本视为已授权。 */
export async function hasNotificationPermission(
  dependencies: Pick<
    NotificationPermissionDependencies,
    'isRuntimePermissionRequired' | 'hasPermission'
  > = productionDependencies
): Promise<boolean> {
  if (!dependencies.isRuntimePermissionRequired()) return true;
  return dependencies.hasPermission();
}

/**
 * 确保应用拥有通知权限。已有权限时不会显示任何界面；申请失败仅提示用户，
 * 由调用方继续启用对应业务功能。
 */
export async function requestNotificationPermission(
  options: NotificationPermissionOptions = {},
  dependencies: NotificationPermissionDependencies = productionDependencies
): Promise<boolean> {
  try {
    if (await hasNotificationPermission(dependencies)) return true;
    if (await dependencies.requestPermission()) return true;
  } catch (error) {
    console.warn('[NotificationPermission] Failed to request permission:', error);
  }

  if (options.showFailureAlert !== false) {
    dependencies.showRequestFailed();
  }
  return false;
}
