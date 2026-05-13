/**
 * Error Service
 * 全局错误发布-订阅服务，供 Service 层发布错误，Store 层订阅更新 UI 状态。
 */

export interface ErrorInfo {
  title: string;
  message: string;
}

type ErrorCallback = (error: ErrorInfo | null) => void;

class ErrorService {
  private callbacks = new Set<ErrorCallback>();

  /**
   * 订阅错误变更，返回取消订阅函数。
   */
  subscribe(callback: ErrorCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  setError(error: ErrorInfo | null): void {
    this.callbacks.forEach((cb) => cb(error));
  }

  clearError(): void {
    this.setError(null);
  }

  showNetworkError(operation: string, detail?: string): void {
    this.setError({
      title: `${operation}失败`,
      message: detail || '网络连接失败，请检查网络设置',
    });
  }
}

export const errorService = new ErrorService();
