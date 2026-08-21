import type { ServerConfig } from '@/types/api';

export type ServerCredentialsValidationError = 'usernameRequired' | 'passwordRequired';

/**
 * 校验服务器认证凭据是否完整，返回缺失字段对应的错误类型。
 */
export function validateServerCredentials(
  type: ServerConfig['type'],
  username: string,
  password: string
): ServerCredentialsValidationError | null {
  const hasUsername = Boolean(username.trim());
  const hasPassword = Boolean(password.trim());

  if (type === 'webdav') {
    return null;
  }

  if (!hasUsername) {
    return 'usernameRequired';
  }

  if (!hasPassword) {
    return 'passwordRequired';
  }

  return null;
}
