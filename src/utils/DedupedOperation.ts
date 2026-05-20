/**
 * 对异步操作进行去重：内容相同时继承前次调用，不同时取消前次调用。
 * 支持多个调用者共享同一次操作的进度回调。
 *
 * @template TContent 操作内容的类型，用于相同性判断
 * @template TResult 操作结果的类型
 * @template TProgress 进度信息的类型
 */
export class DedupedOperation<TContent, TResult, TProgress = never> {
  private _controller: AbortController | null = null;
  private _promise: Promise<TResult> | null = null;
  private _content: TContent | null = null;
  private _callbacks = new Set<(info: TProgress) => void>();

  constructor(private readonly isSame: (a: TContent, b: TContent) => boolean) {}

  /**
   * 执行操作。
   * - 若与正在进行的操作内容相同，则继承（共享进度），等待完成。
   * - 若不同，则取消正在进行的操作并重新开始。
   *
   * @param content 本次操作的内容标识，用于判断是否可以继承
   * @param onProgress 进度回调；继承时同样会收到进度通知
   * @param externalSignal 外部取消信号（会被转发到内部 AbortController）；无外部信号时传 null
   * @param run 实际执行函数，接收内部 signal 和广播进度的 notify 函数
   */
  async execute(
    content: TContent,
    onProgress: ((info: TProgress) => void) | undefined,
    externalSignal: AbortSignal | null | undefined,
    run: (signal: AbortSignal, notify: (info: TProgress) => void) => Promise<TResult>
  ): Promise<TResult> {
    // 相同内容正在运行：继承，共享进度回调，等待完成
    if (this._promise && this._content && this.isSame(content, this._content)) {
      if (onProgress) this._callbacks.add(onProgress);
      try {
        return await this._promise;
      } finally {
        if (onProgress) this._callbacks.delete(onProgress);
      }
    }

    // 不同内容：取消当前操作，重新开始
    if (this._controller) this._controller.abort();
    this._callbacks.clear();
    if (onProgress) this._callbacks.add(onProgress);

    const controller = new AbortController();
    this._controller = controller;
    this._content = content;

    // 转发外部取消信号
    let onExternalAbort: (() => void) | undefined;
    if (externalSignal) {
      onExternalAbort = () => controller.abort(externalSignal.reason);
      if (externalSignal.aborted) {
        controller.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    this._promise = (async () => {
      try {
        return await run(controller.signal, (info: TProgress) => {
          this._callbacks.forEach((cb) => cb(info));
        });
      } finally {
        if (onExternalAbort && externalSignal) {
          externalSignal.removeEventListener('abort', onExternalAbort);
        }
        if (this._controller === controller) {
          this._controller = null;
          this._content = null;
          this._callbacks.clear();
          this._promise = null;
        }
      }
    })();

    return this._promise;
  }

  /** 取消当前正在进行的操作（如有） */
  abort(): void {
    this._controller?.abort();
  }
}
