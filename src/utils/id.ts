let sequence = 0;

/**
 * 生成仅用于本机配置关联的稳定 ID。
 *
 * 不承载安全语义；时间、随机数和进程内序号共同避免导入/快速新增时碰撞。
 */
export function createStableId(prefix: 'server' | 'rule'): string {
  sequence = (sequence + 1) % 0x100000;
  const time = Date.now().toString(36);
  const random = Math.floor(Math.random() * 0x100000000)
    .toString(36)
    .padStart(7, '0');
  return `${prefix}_${time}_${random}_${sequence.toString(36)}`;
}
