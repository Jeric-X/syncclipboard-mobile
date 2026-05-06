import { APIError } from './APIError';

/**
 * 服务器错误
 */
export class ServerError extends APIError {
  constructor(message: string, statusCode: number, response?: unknown) {
    super(message, statusCode, response);
    this.name = 'ServerError';
    Object.setPrototypeOf(this, ServerError.prototype);
  }
}
