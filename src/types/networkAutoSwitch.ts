/**
 * 移动端网络自动切换相关类型。
 */

export type MobileNetworkType = 'wifi' | 'cellular' | 'ethernet' | 'vpn' | 'other';

export type NetworkRuleMatchMode = 'all' | 'any';

export type NetworkNoMatchAction = 'keep' | 'defaultServer' | 'none';

export type NetworkSwitchNotificationMode = 'none' | 'toast' | 'system';

export interface NetworkAutoSwitchRule {
  /** 稳定规则 ID。 */
  id: string;
  name: string;
  enabled: boolean;
  /** 稳定服务器 ID，不能使用数组下标。 */
  targetServerId: string;
  networkTypes: MobileNetworkType[];
  ssids: string[];
  /** 已规范化的 IP 或 CIDR，可在 # 后包含备注。 */
  ipRanges: string[];
  matchMode: NetworkRuleMatchMode;
}

export interface NetworkAutoSwitchConfig {
  enabled: boolean;
  notificationMode: NetworkSwitchNotificationMode;
  noMatchAction: NetworkNoMatchAction;
  defaultServerId?: string;
  rules: NetworkAutoSwitchRule[];
}

export interface MobileNetworkSnapshot {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  type: MobileNetworkType | 'none' | 'unknown';
  /** null 表示系统当前没有提供；空字符串不作为有效 SSID。 */
  ssid: string | null;
  /** 当前默认网络的 IPv4 和 IPv6 地址。 */
  ipAddresses: string[];
  capturedAt: number;
  /** 信息缺失或降级原因，面向状态页展示。 */
  unavailableReasons: Array<
    'ssid-permission' | 'location-services-disabled' | 'ssid-unavailable' | 'ip-unavailable'
  >;
}

export type NetworkEvaluationReason =
  | 'disabled'
  | 'waiting-for-network'
  | 'matched-rule'
  | 'matched-missing-target'
  | 'no-match-keep'
  | 'no-match-default'
  | 'no-match-none'
  | 'no-match-missing-default';

export interface NetworkEvaluationResult {
  reason: NetworkEvaluationReason;
  /** undefined 表示保持当前服务器，null 表示不使用服务器。 */
  targetServerId: string | null | undefined;
  matchedRuleId?: string;
  matchedRuleName?: string;
  hasUnavailableConditions: boolean;
}

export const DEFAULT_NETWORK_AUTO_SWITCH_CONFIG: NetworkAutoSwitchConfig = {
  enabled: false,
  notificationMode: 'none',
  noMatchAction: 'keep',
  rules: [],
};
