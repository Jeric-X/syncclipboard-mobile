import { APIError } from './APIError';

/**
 * 配置错误
 */
export class ConfigurationError extends APIError {
  constructor(message: string = 'Invalid configuration') {
    super(message);
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}
