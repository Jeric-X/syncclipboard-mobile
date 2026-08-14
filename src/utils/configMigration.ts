import type { ServerConfig } from '@/types/api';
import type { AppConfig } from '@/types/storage';
import {
  DEFAULT_NETWORK_AUTO_SWITCH_CONFIG,
  type MobileNetworkType,
  type NetworkAutoSwitchConfig,
  type NetworkAutoSwitchRule,
} from '@/types/networkAutoSwitch';
import { createStableId } from './id';

const NETWORK_TYPES = new Set<MobileNetworkType>(['wifi', 'cellular', 'ethernet', 'vpn', 'other']);

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function migrateRule(value: unknown, usedIds: Set<string>): NetworkAutoSwitchRule | null {
  const raw = objectValue(value);
  let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : createStableId('rule');
  if (usedIds.has(id)) id = createStableId('rule');
  usedIds.add(id);

  const targetServerId = typeof raw.targetServerId === 'string' ? raw.targetServerId.trim() : '';
  const networkTypes = stringArray(raw.networkTypes).filter((type): type is MobileNetworkType =>
    NETWORK_TYPES.has(type as MobileNetworkType)
  );
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : '',
    enabled: raw.enabled !== false,
    targetServerId,
    networkTypes,
    ssids: stringArray(raw.ssids),
    ipRanges: stringArray(raw.ipRanges),
    matchMode: raw.matchMode === 'any' ? 'any' : 'all',
  };
}

function migrateAutoSwitch(value: unknown): NetworkAutoSwitchConfig {
  const raw = objectValue(value);
  const usedRuleIds = new Set<string>();
  const rules = Array.isArray(raw.rules)
    ? raw.rules
        .map((rule) => migrateRule(rule, usedRuleIds))
        .filter((rule): rule is NetworkAutoSwitchRule => rule !== null)
    : [];
  const noMatchAction =
    raw.noMatchAction === 'defaultServer' || raw.noMatchAction === 'none'
      ? raw.noMatchAction
      : 'keep';
  return {
    ...DEFAULT_NETWORK_AUTO_SWITCH_CONFIG,
    enabled: raw.enabled === true,
    notificationMode:
      raw.notificationMode === 'none' ||
      raw.notificationMode === 'toast' ||
      raw.notificationMode === 'system'
        ? raw.notificationMode
        : DEFAULT_NETWORK_AUTO_SWITCH_CONFIG.notificationMode,
    noMatchAction,
    defaultServerId:
      typeof raw.defaultServerId === 'string' && raw.defaultServerId.trim()
        ? raw.defaultServerId.trim()
        : undefined,
    rules,
  };
}

function migrateServers(value: unknown): ServerConfig[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const server = { ...(item as ServerConfig) };
      let id = typeof server.id === 'string' && server.id.trim() ? server.id.trim() : '';
      if (!id || usedIds.has(id)) id = createStableId('server');
      usedIds.add(id);
      return { ...server, id };
    });
}

/**
 * 将旧版或导入配置迁移成当前结构。
 *
 * 迁移保留失效的规则引用供 UI 显示，不会静默改指向其他服务器。
 */
export function migrateAppConfig(value: unknown, defaults: AppConfig): AppConfig {
  const raw = objectValue(value);
  const servers = migrateServers(raw.servers);
  const requestedIndex =
    typeof raw.activeServerIndex === 'number' && Number.isInteger(raw.activeServerIndex)
      ? raw.activeServerIndex
      : defaults.activeServerIndex;
  const activeServerIndex =
    requestedIndex >= 0 && requestedIndex < servers.length ? requestedIndex : -1;

  return {
    ...defaults,
    ...raw,
    servers,
    activeServerIndex,
    networkAutoSwitch: migrateAutoSwitch(raw.networkAutoSwitch),
  } as AppConfig;
}
