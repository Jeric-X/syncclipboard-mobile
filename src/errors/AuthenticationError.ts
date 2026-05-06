import { APIError } from './APIError';

/**
 * 认证错误
 */
export class AuthenticationError extends APIError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}
