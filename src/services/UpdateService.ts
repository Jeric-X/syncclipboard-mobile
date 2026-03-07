/**
 * Update Service
 * 检查 GitHub 最新 Release 版本更新
 */

const GITHUB_RELEASES_API = 'https://api.github.com/repos/Jeric-X/syncclipboard-mobile/releases';
const RELEASES_PAGE_URL = 'https://github.com/Jeric-X/syncclipboard-mobile/releases';

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  build?: number;
  beta?: number;
}

export function versionToStr(v: ParsedVersion): string {
  let s = `${v.major}.${v.minor}.${v.patch}`;
  if (v.build !== undefined) s += `.${v.build}`;
  if (v.beta !== undefined) s += `-beta${v.beta}`;
  return s;
}

/**
 * 解析版本字符串，支持格式：
 *   v1.2.3, 1.2.3, v1.2.3.4, v1.2.3-beta1, 1.2.3.4-beta2
 */
export function parseVersion(versionStr: string): ParsedVersion | null {
  const match = versionStr.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:-beta(\d+))?$/i);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    build: match[4] !== undefined ? parseInt(match[4], 10) : undefined,
    beta: match[5] !== undefined ? parseInt(match[5], 10) : undefined,
  };
}

/**
 * 比较两个版本，返回:
 *   正数 => a > b，负数 => a < b，0 => 相等
 * 规则与 AppVersion.cs 一致：正式版 > beta 版
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const nums: (keyof ParsedVersion)[] = ['major', 'minor', 'patch'];
  for (const key of nums) {
    const av = (a[key] as number | undefined) ?? 0;
    const bv = (b[key] as number | undefined) ?? 0;
    if (av !== bv) return av - bv;
  }

  // build 段（第四位）
  const aBuild = a.build ?? -1;
  const bBuild = b.build ?? -1;
  if (aBuild !== bBuild) {
    // 有 build 段的字段数更多，视为更大
    if (a.build !== undefined && b.build === undefined) return 1;
    if (a.build === undefined && b.build !== undefined) return -1;
    return aBuild - bBuild;
  }

  // beta：正式版 (beta === undefined) > beta 版
  if (a.beta === undefined && b.beta === undefined) return 0;
  if (a.beta === undefined) return 1; // a 是正式版，更大
  if (b.beta === undefined) return -1; // b 是正式版，更大
  return a.beta - b.beta;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  latestVersion: string;
  releaseUrl: string;
}

/**
 * 从 GitHub API 获取最新版本并与当前版本比较
 * @param currentVersionStr 当前版本字符串
 * @param includeBeta 是否包含 beta 版本，默认 false
 */
export async function checkForUpdate(
  currentVersionStr: string,
  includeBeta = false
): Promise<UpdateCheckResult> {
  const response = await fetch(GITHUB_RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
  });

  if (!response.ok) {
    throw new Error(`GitHub API 请求失败: ${response.status}`);
  }

  const releases: Array<{ tag_name: string; prerelease: boolean; draft: boolean }> =
    await response.json();

  // 过滤草稿；若不包含 beta 则进一步过滤 prerelease
  const candidates = releases.filter((r) => {
    if (r.draft) return false;
    if (!includeBeta && r.prerelease) return false;
    return true;
  });

  const latest = candidates[0];
  if (!latest) {
    return { hasUpdate: false, latestVersion: currentVersionStr, releaseUrl: RELEASES_PAGE_URL };
  }

  const latestParsed = parseVersion(latest.tag_name);
  const currentParsed = parseVersion(currentVersionStr);

  if (!currentParsed || !latestParsed) {
    return { hasUpdate: false, latestVersion: latest.tag_name, releaseUrl: RELEASES_PAGE_URL };
  }

  const hasUpdate = compareVersions(latestParsed, currentParsed) > 0;
  return { hasUpdate, latestVersion: versionToStr(latestParsed), releaseUrl: RELEASES_PAGE_URL };
}
