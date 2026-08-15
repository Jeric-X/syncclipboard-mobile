import NetInfo, { NetInfoStateType, type NetInfoState } from '@react-native-community/netinfo';
import {
  Linking,
  PermissionsAndroid,
  Platform,
  type Permission,
  type PermissionStatus,
} from 'react-native';
import {
  addNetworkChangeListener,
  getCurrentNetworkInfo,
  isLocationServicesEnabled,
  openLocationSettings,
} from 'native-util';
import type { MobileNetworkSnapshot } from '@/types/networkAutoSwitch';
import { isUsableRuleAddress, parseIpAddress } from '@/utils/networkAutoSwitch';

export type WifiPermissionState = 'granted' | 'denied' | 'blocked' | 'unavailable';

function mapNetworkType(type: NetInfoStateType | string): MobileNetworkSnapshot['type'] {
  switch (type) {
    case NetInfoStateType.wifi:
    case 'wifi':
      return 'wifi';
    case NetInfoStateType.cellular:
    case 'cellular':
      return 'cellular';
    case NetInfoStateType.ethernet:
    case 'ethernet':
      return 'ethernet';
    case NetInfoStateType.vpn:
    case 'vpn':
      return 'vpn';
    case NetInfoStateType.none:
    case 'none':
      return 'none';
    case NetInfoStateType.unknown:
    case 'unknown':
      return 'unknown';
    default:
      return 'other';
  }
}

function cleanIpAddresses(values: unknown[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const address = value.trim().split('%')[0];
    const parsed = parseIpAddress(address);
    if (!parsed || !isUsableRuleAddress(parsed) || seen.has(address)) continue;
    seen.add(address);
    result.push(address);
  }
  return result;
}

function snapshotFromNetInfo(state: NetInfoState): MobileNetworkSnapshot {
  const details = state.details as Record<string, unknown> | null;
  const type = mapNetworkType(state.type);
  const ssid = type === 'wifi' && typeof details?.ssid === 'string' ? details.ssid : null;
  const ipAddresses = cleanIpAddresses(
    type === 'wifi' || type === 'ethernet' ? [details?.ipAddress] : []
  );
  const unavailableReasons: MobileNetworkSnapshot['unavailableReasons'] = [];
  if (type === 'wifi' && !ssid) unavailableReasons.push('ssid-unavailable');
  if (state.isConnected && ipAddresses.length === 0) unavailableReasons.push('ip-unavailable');
  return {
    isConnected: state.isConnected === true,
    isInternetReachable: state.isInternetReachable,
    type,
    ssid,
    ipAddresses,
    capturedAt: Date.now(),
    unavailableReasons,
  };
}

function requiredWifiPermissions(): Permission[] {
  if (Platform.OS !== 'android') return [];
  return [
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ];
}

export class CurrentNetworkService {
  async getSnapshot(): Promise<MobileNetworkSnapshot> {
    if (Platform.OS === 'android') {
      try {
        const native = getCurrentNetworkInfo();
        if (native) {
          const type = mapNetworkType(native.type);
          const ipAddresses = cleanIpAddresses(native.ipAddresses);
          const unavailableReasons: MobileNetworkSnapshot['unavailableReasons'] = [];
          if (type === 'wifi' && !native.ssidPermissionGranted) {
            unavailableReasons.push('ssid-permission');
          } else if (type === 'wifi' && !native.locationServicesEnabled) {
            unavailableReasons.push('location-services-disabled');
          } else if (type === 'wifi' && !native.ssid) {
            unavailableReasons.push('ssid-unavailable');
          }
          if (native.isConnected && ipAddresses.length === 0) {
            unavailableReasons.push('ip-unavailable');
          }
          return {
            isConnected: native.isConnected,
            isInternetReachable: native.isInternetReachable,
            type,
            ssid: native.ssid?.trim() || null,
            ipAddresses,
            capturedAt: Date.now(),
            unavailableReasons,
          };
        }
      } catch (error) {
        console.warn('[CurrentNetworkService] Native snapshot failed, using NetInfo:', error);
      }
    }
    return snapshotFromNetInfo(await NetInfo.fetch());
  }

  /** 网络事件只作为失效信号，评估时会重新读取一份完整快照。 */
  subscribe(listener: () => void): () => void {
    if (Platform.OS === 'android') {
      const subscription = addNetworkChangeListener(listener);
      if (subscription) return () => subscription.remove();
    }
    return NetInfo.addEventListener(() => listener());
  }

  async getWifiPermissionState(): Promise<WifiPermissionState> {
    if (Platform.OS !== 'android') return 'unavailable';
    const permissions = requiredWifiPermissions();
    const granted = await Promise.all(
      permissions.map((permission) => PermissionsAndroid.check(permission))
    );
    return granted.every(Boolean) ? 'granted' : 'denied';
  }

  async requestWifiPermission(): Promise<WifiPermissionState> {
    if (Platform.OS !== 'android') return 'unavailable';
    const result = await PermissionsAndroid.requestMultiple(requiredWifiPermissions());
    const statuses = Object.values(result) as PermissionStatus[];
    if (statuses.every((status) => status === PermissionsAndroid.RESULTS.GRANTED)) return 'granted';
    if (statuses.some((status) => status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) {
      return 'blocked';
    }
    return 'denied';
  }

  async getFineLocationPermissionState(): Promise<WifiPermissionState> {
    if (Platform.OS !== 'android') return 'unavailable';
    return (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION))
      ? 'granted'
      : 'denied';
  }

  async requestFineLocationPermission(): Promise<WifiPermissionState> {
    if (Platform.OS !== 'android') return 'unavailable';
    return this.requestWifiPermission();
  }

  async getBackgroundLocationPermissionState(): Promise<WifiPermissionState> {
    if (Platform.OS !== 'android' || Number(Platform.Version) < 29) return 'unavailable';
    return (await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION
    ))
      ? 'granted'
      : 'denied';
  }

  async requestBackgroundLocationPermission(): Promise<WifiPermissionState> {
    if (Platform.OS !== 'android' || Number(Platform.Version) < 29) return 'unavailable';
    if ((await this.getFineLocationPermissionState()) !== 'granted') return 'denied';

    // Android 11+ 不再提供后台位置运行时弹窗，只能由用户在应用设置中选择“始终允许”。
    if (Number(Platform.Version) >= 30) {
      await this.openSystemSettings();
      return this.getBackgroundLocationPermissionState();
    }

    return this.mapPermissionResult(
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION)
    );
  }

  isLocationServicesEnabled(): boolean {
    return isLocationServicesEnabled();
  }

  openLocationSettings(): void {
    if (!openLocationSettings()) void Linking.openSettings();
  }

  async openSystemSettings(): Promise<void> {
    await Linking.openSettings();
  }

  private mapPermissionResult(status: PermissionStatus): WifiPermissionState {
    if (status === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
    if (status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
    return 'denied';
  }
}

export const currentNetworkService = new CurrentNetworkService();
