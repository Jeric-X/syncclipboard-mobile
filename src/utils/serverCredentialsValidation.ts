import type { ServerConfig } from '@/types/api';

export type ServerCredentialsValidationError = 'usernameRequired' | 'passwordRequired';

export type ServerConnectionTestValidationError =
  | 's3FieldsRequired'
  | 'urlRequired'
  | 'fieldsRequired';

/**
 * 连接测试所需的服务器字段。
 */
export interface ServerConnectionTestFields {
  type: ServerConfig['type'];
  url: string;
  username: string;
  password: string;
  bucketName: string;
}

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

/**
 * 校验连接测试所需字段，返回对应的提示类型。
 */
export function validateServerConnectionTestFields({
  type,
  url,
  username,
  password,
  bucketName,
}: ServerConnectionTestFields): ServerConnectionTestValidationError | null {
  if (type === 's3') {
    return !bucketName.trim() || !username.trim() || !password.trim() ? 's3FieldsRequired' : null;
  }

  if (!url.trim()) {
    return type === 'webdav' ? 'urlRequired' : 'fieldsRequired';
  }

  if (validateServerCredentials(type, username, password)) {
    return 'fieldsRequired';
  }

  return null;
}
