/**
 * Profile ID Utilities
 * ProfileId 工具函数
 */

/**
 * 生成 profileId
 */
export function getProfileId(type: string, hash: string): string {
  return `${type}-${hash}`;
}

/**
 * 从 profileId 解析 type 和 hash
 */
export function parseProfileId(
  profileId: string
): { type: 'Text' | 'Image' | 'File'; hash: string } | null {
  const parts = profileId.split('-');
  if (parts.length < 2) {
    return null;
  }
  const type = parts[0] as 'Text' | 'Image' | 'File';
  const hash = parts.slice(1).join('-');
  if (!['Text', 'Image', 'File'].includes(type)) {
    return null;
  }
  return { type, hash };
}
