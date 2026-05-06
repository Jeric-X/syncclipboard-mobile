import { APIError } from './APIError';

/**
 * 网络错误
 */
export class NetworkError extends APIError {
  constructor(
    message: string = 'Network request failed',
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}
