/**
 * API Client Base Class
 * Handles HTTP requests with authentication and error handling
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import { AuthService } from './AuthService';
import {
  APIError,
  AuthenticationError,
  NetworkError,
  ServerError,
  TimeoutError,
  ConfigurationError,
} from './errors';

/**
 * API 客户端配置
 */
export interface APIClientConfig {
  /** 基础 URL */
  baseURL: string;

  /** 超时时间（毫秒） */
  timeout?: number;

  /** 认证服务 */
  authService?: AuthService;

  /** 附加请求头 */
  headers?: Record<string, string>;
}

/**
 * API 客户端基类
 */
export class APIClient {
  protected client: AxiosInstance;
  protected authService?: AuthService;
  protected baseURL: string;

  constructor(config: APIClientConfig) {
    const { baseURL, timeout = 30000, authService, headers = {} } = config;

    if (!baseURL) {
      throw new ConfigurationError('Base URL is required');
    }

    this.baseURL = baseURL;
    this.authService = authService;

    // 创建 Axios 实例
    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });

    // 设置拦截器
    this.setupInterceptors();
  }

  /**
   * 设置请求和响应拦截器
   */
  private setupInterceptors(): void {
    // 请求拦截器 - 添加认证头
    this.client.interceptors.request.use(
      (config) => {
        // 添加认证头
        if (this.authService?.isConfigured()) {
          try {
            config.headers.Authorization = this.authService.getAuthHeader();
          } catch (error) {
            console.warn('Failed to add auth header:', error);
          }
        }

        // 日志：请求信息
        if (__DEV__) {
          console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
        }

        return config;
      },
      (error) => {
        return Promise.reject(this.handleError(error));
      }
    );

    // 响应拦截器 - 统一错误处理
    this.client.interceptors.response.use(
      (response) => {
        // 日志：响应信息
        if (__DEV__) {
          console.log(`[API] Response ${response.status} ${response.config.url}`);
        }
        return response;
      },
      (error) => {
        return Promise.reject(this.handleError(error));
      }
    );
  }

  /**
   * 统一错误处理
   */
  protected handleError(error: unknown): APIError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      // 网络错误
      if (!axiosError.response) {
        if (axiosError.code === 'ECONNABORTED' || axiosError.message.includes('timeout')) {
          return new TimeoutError('Request timeout');
        }
        return new NetworkError('Network request failed', axiosError);
      }

      // HTTP 错误
      const { status, data } = axiosError.response;
      
      // 记录响应详情
      console.error('[APIClient] HTTP Error - Status:', status);
      console.error('[APIClient] Response data:', JSON.stringify(data, null, 2));

      // 401 未授权
      if (status === 401) {
        return new AuthenticationError('Invalid credentials or authentication failed');
      }

      // 403 禁止访问
      if (status === 403) {
        return new AuthenticationError('Access forbidden');
      }

      // 404 未找到
      if (status === 404) {
        return new ServerError('Resource not found', status, data);
      }

      // 500+ 服务器错误
      if (status >= 500) {
        return new ServerError('Server error', status, data);
      }

      // 其他 HTTP 错误
      return new ServerError(`HTTP ${status}: ${axiosError.message}`, status, data);
    }

    // 其他类型的错误
    if (error instanceof APIError) {
      return error;
    }

    // 未知错误
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return new APIError(message);
  }

  /**
   * 设置认证服务
   */
  setAuthService(authService: AuthService): void {
    this.authService = authService;
  }

  /**
   * 获取基础 URL
   */
  getBaseURL(): string {
    return this.baseURL;
  }

  /**
   * 获取包含认证信息的请求头
   */
  protected async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // 添加认证头
    if (this.authService?.isConfigured()) {
      try {
        headers.Authorization = this.authService.getAuthHeader();
      } catch (error) {
        console.warn('Failed to add auth header:', error);
      }
    }

    return headers;
  }

  /**
   * 更新基础 URL
   */
  setBaseURL(baseURL: string): void {
    this.baseURL = baseURL;
    this.client.defaults.baseURL = baseURL;
  }

  /**
   * GET 请求
   */
  protected async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  /**
   * POST 请求
   */
  protected async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  /**
   * PUT 请求
   */
  protected async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  /**
   * DELETE 请求
   */
  protected async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }

  /**
   * PATCH 请求
   */
  protected async patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.client.patch<T>(url, data, config);
    return response.data;
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<void> {
    await this.get('/');
  }
}
