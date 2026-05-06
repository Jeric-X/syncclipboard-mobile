import { APIError } from './APIError';

/**
 * 数据验证错误
 */
export class ValidationError extends APIError {
  constructor(message: string = 'Data validation failed') {
    super(message, 400);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
