import { APIError } from './APIError';

/**
 * 超时错误
 */
export class TimeoutError extends APIError {
  constructor(message: string = 'Request timeout') {
    super(message);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}
