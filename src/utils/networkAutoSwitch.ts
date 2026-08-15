import type { TFunction } from 'i18next';
import type { ServerConfig } from '@/types/api';
import type { NetworkAutoSwitchState } from '@/services/NetworkAutoSwitchService';
import type {
  MobileNetworkSnapshot,
  MobileNetworkType,
  NetworkAutoSwitchConfig,
  NetworkAutoSwitchRule,
  NetworkEvaluationResult,
} from '@/types/networkAutoSwitch';

export function getNetworkAutoSwitchDescription(
  enabled: boolean,
  runtime: NetworkAutoSwitchState,
  t: TFunction
): string {
  if (!enabled) return t('networkAutoSwitch.statusDisabled');
  if (runtime.manualOverride) return t('networkAutoSwitch.statusManualOverride');
  if (runtime.phase === 'detecting') return t('networkAutoSwitch.statusDetecting');
  if (runtime.phase === 'waiting') return t('networkAutoSwitch.statusWaiting');
  if (runtime.evaluation?.matchedRuleName) {
    return t('networkAutoSwitch.summaryMatchedRule', {
      rule: runtime.evaluation.matchedRuleName,
    });
  }
  return t('networkAutoSwitch.summaryNoMatch');
}

interface ParsedIp {
  family: 4 | 6;
  bytes: number[];
}

export interface NormalizedIpRule {
  normalized: string;
  address: string;
  prefixLength: number;
  family: 4 | 6;
  comment?: string;
}

export type IpRuleErrorCode =
  | 'empty-address'
  | 'invalid-cidr'
  | 'invalid-address'
  | 'unusable-address'
  | 'invalid-prefix'
  | 'range-too-broad';

export class IpRuleError extends Error {
  constructor(
    readonly code: IpRuleErrorCode,
    readonly maxPrefix?: number
  ) {
    super(code);
    this.name = 'IpRuleError';
  }
}

function parseIpv4(value: string): ParsedIp | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const parsed = Number(part);
    if (parsed < 0 || parsed > 255) return null;
    bytes.push(parsed);
  }
  return { family: 4, bytes };
}

function parseIpv6(value: string): ParsedIp | null {
  const zoneIndex = value.indexOf('%');
  const withoutZone = zoneIndex >= 0 ? value.slice(0, zoneIndex) : value;
  if (!withoutZone || (withoutZone.match(/::/g)?.length ?? 0) > 1) return null;

  let source = withoutZone.toLowerCase();
  const ipv4TailMatch = source.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4TailMatch) {
    const ipv4 = parseIpv4(ipv4TailMatch[1]);
    if (!ipv4) return null;
    const high = ((ipv4.bytes[0] << 8) | ipv4.bytes[1]).toString(16);
    const low = ((ipv4.bytes[2] << 8) | ipv4.bytes[3]).toString(16);
    source = `${source.slice(0, source.length - ipv4TailMatch[1].length)}${high}:${low}`;
  }

  const hasCompression = source.includes('::');
  const [leftSource, rightSource = ''] = source.split('::');
  const left = leftSource ? leftSource.split(':') : [];
  const right = rightSource ? rightSource.split(':') : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;

  const explicitCount = left.length + right.length;
  if ((!hasCompression && explicitCount !== 8) || (hasCompression && explicitCount >= 8)) {
    return null;
  }
  const groups = hasCompression ? [...left, ...Array(8 - explicitCount).fill('0'), ...right] : left;
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    const parsed = Number.parseInt(group, 16);
    bytes.push((parsed >> 8) & 0xff, parsed & 0xff);
  }
  return { family: 6, bytes };
}

export function parseIpAddress(value: string): ParsedIp | null {
  const trimmed = value.trim();
  return parseIpv4(trimmed) ?? parseIpv6(trimmed);
}

function formatIpv4(bytes: number[]): string {
  return bytes.join('.');
}

function formatIpv6(bytes: number[]): string {
  const groups = Array.from({ length: 8 }, (_, index) => {
    return ((bytes[index * 2] << 8) | bytes[index * 2 + 1]).toString(16);
  });

  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length; ) {
    if (groups[index] !== '0') {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === '0') end += 1;
    if (end - index > bestLength && end - index >= 2) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }

  if (bestStart < 0) return groups.join(':');
  const left = groups.slice(0, bestStart).join(':');
  const right = groups.slice(bestStart + bestLength).join(':');
  if (!left && !right) return '::';
  if (!left) return `::${right}`;
  if (!right) return `${left}::`;
  return `${left}::${right}`;
}

function formatIp(ip: ParsedIp): string {
  return ip.family === 4 ? formatIpv4(ip.bytes) : formatIpv6(ip.bytes);
}

function networkBytes(bytes: number[], prefixLength: number): number[] {
  return bytes.map((byte, index) => {
    const remaining = prefixLength - index * 8;
    if (remaining >= 8) return byte;
    if (remaining <= 0) return 0;
    return byte & (0xff << (8 - remaining));
  });
}

export function isUsableRuleAddress(ip: ParsedIp): boolean {
  const { family, bytes } = ip;
  const allZero = bytes.every((byte) => byte === 0);
  if (allZero) return false;
  if (family === 4) {
    if (bytes[0] === 127) return false;
    if (bytes[0] === 169 && bytes[1] === 254) return false;
    if (bytes[0] >= 224) return false;
    return true;
  }
  const isLoopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  if (isLoopback) return false;
  if (bytes[0] === 0xff) return false;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return false;
  return true;
}

/** 解析、校验并规范化一行 IP/CIDR，保留 # 后的备注。 */
export function normalizeIpRuleLine(line: string): NormalizedIpRule {
  const hashIndex = line.indexOf('#');
  const rawValue = (hashIndex >= 0 ? line.slice(0, hashIndex) : line).trim();
  const comment = hashIndex >= 0 ? line.slice(hashIndex + 1).trim() : '';
  if (!rawValue) throw new IpRuleError('empty-address');

  const slashIndex = rawValue.indexOf('/');
  if (slashIndex !== rawValue.lastIndexOf('/')) throw new IpRuleError('invalid-cidr');
  const addressValue = slashIndex >= 0 ? rawValue.slice(0, slashIndex).trim() : rawValue;
  const prefixValue = slashIndex >= 0 ? rawValue.slice(slashIndex + 1).trim() : '';
  const parsed = parseIpAddress(addressValue);
  if (!parsed) throw new IpRuleError('invalid-address');
  if (!isUsableRuleAddress(parsed)) throw new IpRuleError('unusable-address');

  const maxPrefix = parsed.family === 4 ? 32 : 128;
  const prefixLength = slashIndex < 0 ? maxPrefix : Number(prefixValue);
  if (
    !/^\d+$/.test(prefixValue || String(maxPrefix)) ||
    prefixLength < 0 ||
    prefixLength > maxPrefix
  ) {
    throw new IpRuleError('invalid-prefix', maxPrefix);
  }

  const normalizedIp: ParsedIp = {
    family: parsed.family,
    bytes: networkBytes(parsed.bytes, prefixLength),
  };
  if (!isUsableRuleAddress(normalizedIp)) {
    throw new IpRuleError('range-too-broad');
  }
  const address = formatIp(normalizedIp);
  const value = slashIndex < 0 ? formatIp(parsed) : `${address}/${prefixLength}`;
  return {
    normalized: comment ? `${value} # ${comment}` : value,
    address,
    prefixLength,
    family: parsed.family,
    comment: comment || undefined,
  };
}

export function normalizeIpRuleLines(lines: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const parsed = normalizeIpRuleLine(line);
    const key = `${parsed.family}:${parsed.address}/${parsed.prefixLength}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(parsed.normalized);
  }
  return result;
}

export function ipMatchesRule(ipValue: string, ruleLine: string): boolean {
  const ip = parseIpAddress(ipValue);
  if (!ip) return false;
  let rule: NormalizedIpRule;
  try {
    rule = normalizeIpRuleLine(ruleLine);
  } catch {
    return false;
  }
  if (ip.family !== rule.family) return false;
  const ruleIp = parseIpAddress(rule.address);
  if (!ruleIp) return false;
  const candidateNetwork = networkBytes(ip.bytes, rule.prefixLength);
  return candidateNetwork.every((byte, index) => byte === ruleIp.bytes[index]);
}

function normalizedUniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function normalizeNetworkRule(rule: NetworkAutoSwitchRule): NetworkAutoSwitchRule {
  const allowedTypes = new Set<MobileNetworkType>(['wifi', 'cellular', 'ethernet', 'vpn', 'other']);
  const networkTypes = normalizedUniqueStrings(rule.networkTypes).filter(
    (value): value is MobileNetworkType => allowedTypes.has(value as MobileNetworkType)
  );
  return {
    ...rule,
    name: rule.name.trim(),
    targetServerId: rule.targetServerId.trim(),
    networkTypes,
    ssids: normalizedUniqueStrings(rule.ssids),
    ipRanges: normalizeIpRuleLines(rule.ipRanges),
    matchMode: rule.matchMode === 'any' ? 'any' : 'all',
  };
}

/** 保存层校验，防止绕过编辑页面写入空规则。 */
export function validateNetworkRule(
  rule: NetworkAutoSwitchRule,
  validServerIds: ReadonlySet<string>
): void {
  if (!rule.name.trim()) throw new Error('Rule name is required');
  if (!validServerIds.has(rule.targetServerId)) throw new Error('Target server does not exist');
  if (rule.networkTypes.length === 0 && rule.ssids.length === 0 && rule.ipRanges.length === 0) {
    throw new Error('At least one network condition is required');
  }
}

function matchRule(
  rule: NetworkAutoSwitchRule,
  snapshot: MobileNetworkSnapshot
): { matches: boolean; hasUnavailableConditions: boolean } {
  const groups: boolean[] = [];
  let hasUnavailableConditions = false;

  if (rule.networkTypes.length > 0) {
    groups.push(
      snapshot.type !== 'none' &&
        snapshot.type !== 'unknown' &&
        rule.networkTypes.includes(snapshot.type)
    );
  }
  if (rule.ssids.length > 0) {
    if (!snapshot.ssid) hasUnavailableConditions = true;
    groups.push(!!snapshot.ssid && rule.ssids.includes(snapshot.ssid));
  }
  if (rule.ipRanges.length > 0) {
    if (snapshot.ipAddresses.length === 0) hasUnavailableConditions = true;
    groups.push(
      snapshot.ipAddresses.some((ip) => rule.ipRanges.some((range) => ipMatchesRule(ip, range)))
    );
  }

  if (groups.length === 0) return { matches: false, hasUnavailableConditions };
  return {
    matches: rule.matchMode === 'any' ? groups.some(Boolean) : groups.every(Boolean),
    hasUnavailableConditions,
  };
}

export function evaluateNetworkAutoSwitch(
  config: NetworkAutoSwitchConfig,
  servers: ServerConfig[],
  snapshot: MobileNetworkSnapshot
): NetworkEvaluationResult {
  if (!config.enabled) {
    return { reason: 'disabled', targetServerId: undefined, hasUnavailableConditions: false };
  }
  if (!snapshot.isConnected || snapshot.type === 'none') {
    return {
      reason: 'waiting-for-network',
      targetServerId: undefined,
      hasUnavailableConditions: false,
    };
  }

  let hasUnavailableConditions = false;
  for (const originalRule of config.rules) {
    if (!originalRule.enabled) continue;
    let rule: NetworkAutoSwitchRule;
    try {
      rule = normalizeNetworkRule(originalRule);
    } catch {
      continue;
    }
    const match = matchRule(rule, snapshot);
    hasUnavailableConditions ||= match.hasUnavailableConditions;
    if (!match.matches) continue;
    const targetExists = servers.some((server) => server.id === rule.targetServerId);
    return {
      reason: targetExists ? 'matched-rule' : 'matched-missing-target',
      targetServerId: targetExists ? rule.targetServerId : null,
      matchedRuleId: rule.id,
      matchedRuleName: rule.name,
      hasUnavailableConditions,
    };
  }

  if (config.noMatchAction === 'keep') {
    return { reason: 'no-match-keep', targetServerId: undefined, hasUnavailableConditions };
  }
  if (config.noMatchAction === 'none') {
    return { reason: 'no-match-none', targetServerId: null, hasUnavailableConditions };
  }
  const defaultExists = servers.some((server) => server.id === config.defaultServerId);
  return {
    reason: defaultExists ? 'no-match-default' : 'no-match-missing-default',
    targetServerId: defaultExists ? config.defaultServerId : null,
    hasUnavailableConditions,
  };
}

export function getNetworkFingerprint(snapshot: MobileNetworkSnapshot): string {
  return JSON.stringify({
    connected: snapshot.isConnected,
    type: snapshot.type,
    ssid: snapshot.ssid,
    ips: [...snapshot.ipAddresses].sort(),
  });
}
