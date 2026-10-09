/** 冷启动时本地和远端各自只消费一次的基线策略。 */
export class ClipboardStartupBaseline {
  private headless: boolean | null = null;
  private readonly pending = new Set<'local' | 'remote'>(['local', 'remote']);

  /** 首个运行时入口决定启动模式，后续 UI/Headless 入口不得重新设定基线。 */
  initialize(headless: boolean): void {
    if (this.headless === null) this.headless = headless;
  }

  /** 已有内容哈希时说明基线已经建立，不能吞掉下一次真实变化。 */
  consume(direction: 'local' | 'remote', previousHash: string | null): boolean {
    const first = this.pending.delete(direction);
    return this.headless === true && first && previousHash === null;
  }
}
