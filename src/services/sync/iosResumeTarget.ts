import type { ServerConfig } from '@/types/api';

/** 标识剪贴板存储目标；同一账号轮换密码仍访问同一份内容。 */
export function resumeTargetIdentity(server?: ServerConfig): string {
  return server
    ? JSON.stringify([
        server.id,
        server.type,
        server.url,
        server.username ?? '',
        server.bucketName ?? '',
        server.objectPrefix ?? '',
      ])
    : '';
}
