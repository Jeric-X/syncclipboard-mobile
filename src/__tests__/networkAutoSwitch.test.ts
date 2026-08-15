import type { ServerConfig } from '@/types/api';
import {
  DEFAULT_NETWORK_AUTO_SWITCH_CONFIG,
  type MobileNetworkSnapshot,
  type NetworkAutoSwitchConfig,
  type NetworkAutoSwitchRule,
} from '@/types/networkAutoSwitch';
import {
  evaluateNetworkAutoSwitch,
  getNetworkFingerprint,
  ipMatchesRule,
  normalizeIpRuleLine,
  normalizeIpRuleLines,
  normalizeNetworkRule,
  parseIpAddress,
  validateNetworkRule,
  IpRuleError,
} from '@/utils/networkAutoSwitch';

const servers: ServerConfig[] = [
  { id: 'home', name: '家庭', type: 'syncclipboard', url: 'http://192.168.1.2' },
  { id: 'public', name: '公网', type: 'syncclipboard', url: 'https://example.com' },
];

const connected: MobileNetworkSnapshot = {
  isConnected: true,
  isInternetReachable: true,
  type: 'wifi',
  ssid: 'Home-5G',
  ipAddresses: ['192.168.1.20', '2001:db8:1::20'],
  capturedAt: 100,
  unavailableReasons: [],
};

function rule(overrides: Partial<NetworkAutoSwitchRule> = {}): NetworkAutoSwitchRule {
  return {
    id: 'rule-1',
    name: '家庭网络',
    enabled: true,
    targetServerId: 'home',
    networkTypes: [],
    ssids: [],
    ipRanges: [],
    matchMode: 'all',
    ...overrides,
  };
}

function config(overrides: Partial<NetworkAutoSwitchConfig> = {}): NetworkAutoSwitchConfig {
  return {
    enabled: true,
    notificationMode: 'system',
    noMatchAction: 'keep',
    rules: [],
    ...overrides,
  };
}

describe('默认配置', () => {
  it('默认不发送切换通知', () => {
    expect(DEFAULT_NETWORK_AUTO_SWITCH_CONFIG.notificationMode).toBe('none');
  });
});

describe('IP/CIDR 规则', () => {
  it('解析 IPv4 与压缩 IPv6', () => {
    expect(parseIpAddress('192.168.1.2')?.bytes).toEqual([192, 168, 1, 2]);
    expect(parseIpAddress('2001:db8::1')?.bytes).toHaveLength(16);
    expect(parseIpAddress('::ffff:192.168.1.2')?.bytes).toHaveLength(16);
    expect(parseIpAddress('2001:::1')).toBeNull();
  });

  it('规范化 IPv4 和 IPv6 网段并保留备注', () => {
    expect(normalizeIpRuleLine('192.168.1.20/24 # Home').normalized).toBe('192.168.1.0/24 # Home');
    expect(normalizeIpRuleLine('2001:0db8:0001::20/64').normalized).toBe('2001:db8:1::/64');
    expect(normalizeIpRuleLine('192.168.1.20').normalized).toBe('192.168.1.20');
  });

  it('拒绝非法、回环、链路本地、组播和未指定地址', () => {
    for (const value of [
      '300.1.1.1',
      '127.0.0.1',
      '169.254.1.1',
      '224.0.0.1',
      '0.0.0.0',
      '::',
      '::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1/129',
      '192.168.1.1/0',
    ]) {
      expect(() => normalizeIpRuleLine(value)).toThrow();
    }
  });

  it('校验错误使用稳定错误码而不是界面语言', () => {
    try {
      normalizeIpRuleLine('300.1.1.1');
      throw new Error('Expected normalizeIpRuleLine to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(IpRuleError);
      expect((error as IpRuleError).code).toBe('invalid-address');
    }
  });

  it('正确匹配 IPv4/IPv6 CIDR 边界', () => {
    expect(ipMatchesRule('192.168.1.255', '192.168.1.20/24')).toBe(true);
    expect(ipMatchesRule('192.168.2.0', '192.168.1.0/24')).toBe(false);
    expect(ipMatchesRule('2001:db8:1:ffff::1', '2001:db8:1::/48')).toBe(true);
    expect(ipMatchesRule('2001:db8:2::1', '2001:db8:1::/48')).toBe(false);
    expect(ipMatchesRule('192.168.1.20', '192.168.1.20')).toBe(true);
    expect(ipMatchesRule('192.168.1.21', '192.168.1.20')).toBe(false);
  });

  it('去除空行和按规范化网段去重', () => {
    expect(
      normalizeIpRuleLines([
        '',
        '# comment',
        '192.168.1.20/24 # first',
        '192.168.1.30/24 # duplicate',
      ])
    ).toEqual(['192.168.1.0/24 # first']);
  });
});

describe('网络自动切换规则评估', () => {
  it('按顺序使用第一条命中规则', () => {
    const result = evaluateNetworkAutoSwitch(
      config({
        rules: [
          rule({ id: 'first', targetServerId: 'public', networkTypes: ['wifi'] }),
          rule({ id: 'second', targetServerId: 'home', ssids: ['Home-5G'] }),
        ],
      }),
      servers,
      connected
    );
    expect(result).toMatchObject({
      reason: 'matched-rule',
      targetServerId: 'public',
      matchedRuleId: 'first',
    });
  });

  it('同组任意命中，不同组默认全部命中', () => {
    const homeRule = rule({
      networkTypes: ['wifi', 'ethernet'],
      ssids: ['Home-2G', 'Home-5G'],
      ipRanges: ['192.168.1.0/24'],
      matchMode: 'all',
    });
    expect(
      evaluateNetworkAutoSwitch(config({ rules: [homeRule] }), servers, connected).reason
    ).toBe('matched-rule');

    const wrongSsid = { ...connected, ssid: 'Office' };
    expect(
      evaluateNetworkAutoSwitch(config({ rules: [homeRule] }), servers, wrongSsid).reason
    ).toBe('no-match-keep');
  });

  it('任意条件组命中时允许其他信息不可用', () => {
    const snapshot: MobileNetworkSnapshot = {
      ...connected,
      ssid: null,
      unavailableReasons: ['ssid-permission'],
    };
    const result = evaluateNetworkAutoSwitch(
      config({
        rules: [rule({ networkTypes: ['wifi'], ssids: ['Home-5G'], matchMode: 'any' })],
      }),
      servers,
      snapshot
    );
    expect(result.reason).toBe('matched-rule');
    expect(result.hasUnavailableConditions).toBe(true);
  });

  it('SSID 精确匹配且区分大小写', () => {
    const result = evaluateNetworkAutoSwitch(
      config({ rules: [rule({ ssids: ['home-5g'] })] }),
      servers,
      connected
    );
    expect(result.reason).toBe('no-match-keep');
  });

  it('断网时保持当前服务器且不执行 no-match', () => {
    const result = evaluateNetworkAutoSwitch(config({ noMatchAction: 'none' }), servers, {
      ...connected,
      isConnected: false,
      type: 'none',
    });
    expect(result).toMatchObject({ reason: 'waiting-for-network', targetServerId: undefined });
  });

  it.each([
    ['keep', undefined, 'no-match-keep'],
    ['none', null, 'no-match-none'],
    ['defaultServer', 'public', 'no-match-default'],
  ] as const)('执行 %s 无匹配动作', (action, target, reason) => {
    const result = evaluateNetworkAutoSwitch(
      config({ noMatchAction: action, defaultServerId: 'public' }),
      servers,
      connected
    );
    expect(result).toMatchObject({ reason, targetServerId: target });
  });

  it('默认或规则目标失效时进入不使用服务器且不向后匹配', () => {
    const matched = evaluateNetworkAutoSwitch(
      config({
        rules: [
          rule({ id: 'broken', targetServerId: 'missing', networkTypes: ['wifi'] }),
          rule({ id: 'valid', targetServerId: 'home', networkTypes: ['wifi'] }),
        ],
      }),
      servers,
      connected
    );
    expect(matched).toMatchObject({
      reason: 'matched-missing-target',
      targetServerId: null,
      matchedRuleId: 'broken',
    });

    const fallback = evaluateNetworkAutoSwitch(
      config({ noMatchAction: 'defaultServer', defaultServerId: 'missing' }),
      servers,
      connected
    );
    expect(fallback).toMatchObject({
      reason: 'no-match-missing-default',
      targetServerId: null,
    });
  });

  it('跳过禁用和空条件规则', () => {
    const result = evaluateNetworkAutoSwitch(
      config({
        rules: [
          rule({ id: 'disabled', enabled: false, networkTypes: ['wifi'] }),
          rule({ id: 'empty' }),
          rule({ id: 'valid', networkTypes: ['wifi'] }),
        ],
      }),
      servers,
      connected
    );
    expect(result.matchedRuleId).toBe('valid');
  });

  it('规则规范化去重网络类型与 SSID', () => {
    expect(
      normalizeNetworkRule(
        rule({
          name: '  家庭  ',
          networkTypes: ['wifi', 'wifi'],
          ssids: ['Home', 'Home', '  Office  '],
        })
      )
    ).toMatchObject({
      name: '家庭',
      networkTypes: ['wifi'],
      ssids: ['Home', 'Office'],
    });
  });

  it('保存层拒绝空规则和失效目标', () => {
    expect(() => validateNetworkRule(rule(), new Set(['home']))).toThrow(
      'At least one network condition'
    );
    expect(() =>
      validateNetworkRule(
        rule({ targetServerId: 'missing', networkTypes: ['wifi'] }),
        new Set(['home'])
      )
    ).toThrow('Target server');
  });

  it('网络指纹忽略检测时间和 IP 顺序', () => {
    expect(getNetworkFingerprint(connected)).toBe(
      getNetworkFingerprint({
        ...connected,
        capturedAt: 999,
        ipAddresses: [...connected.ipAddresses].reverse(),
      })
    );
  });
});
