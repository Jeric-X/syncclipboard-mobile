/**
 * WebDAV Client
 * Implements SyncClipboard API using WebDAV protocol
 */

import { APIClient } from './APIClient';
import { ProfileDto, ServerInfo } from '../types/api';
import { ISyncClipboardAPI } from './SyncClipboardAPI';
import { ValidationError } from './errors';
import { AuthService } from './AuthService';

/**
 * WebDAV 客户端配置
 */
export interface WebDAVConfig {
  baseURL: string;
  username: string;
  password: string;
  timeout?: number;
}

/**
 * WebDAV 客户端
 * 使用 WebDAV 协议实现剪贴板同步
 */
export class WebDAVClient extends APIClient implements ISyncClipboardAPI {
  private static readonly PROFILE_FILENAME = 'SyncClipboard.json';
  private static readonly DATA_FOLDER = 'SyncClipboard';

  constructor(config: WebDAVConfig) {
    const { baseURL, username, password, timeout } = config;

    // 创建认证服务
    const authService = new AuthService(username, password);

    // 调用父类构造函数
    super({
      baseURL,
      timeout,
      authService,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * 获取剪贴板配置
   */
  async getClipboard(): Promise<ProfileDto> {
    try {
      // WebDAV GET 请求获取文件
      const profile = await this.get<ProfileDto>(`/${WebDAVClient.PROFILE_FILENAME}`);

      // 验证响应数据
      this.validateProfile(profile);

      return profile;
    } catch (error) {
      console.error('[WebDAVClient] Failed to get clipboard:', error);
      throw error;
    }
  }

  /**
   * 上传剪贴板配置
   */
  async putClipboard(profile: ProfileDto): Promise<void> {
    try {
      // 验证输入数据
      this.validateProfile(profile);

      // 确保目录存在
      await this.ensureDirectoryExists('/');

      // WebDAV PUT 请求上传文件
      await this.put(`/${WebDAVClient.PROFILE_FILENAME}`, profile);
    } catch (error) {
      console.error('[WebDAVClient] Failed to put clipboard:', error);
      throw error;
    }
  }

  /**
   * 获取文件数据
   */
  async getFile(fileName: string): Promise<Blob> {
    if (!fileName) {
      throw new ValidationError('File name is required');
    }

    try {
      const url = `/${WebDAVClient.DATA_FOLDER}/${encodeURIComponent(fileName)}`;
      const blob = await this.get<Blob>(url, {
        responseType: 'blob',
      });

      return blob;
    } catch (error) {
      console.error(`[WebDAVClient] Failed to get file ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * 上传文件数据
   */
  async putFile(fileName: string, data: Blob): Promise<void> {
    if (!fileName) {
      throw new ValidationError('File name is required');
    }

    if (!data) {
      throw new ValidationError('File data is required');
    }

    try {
      // 确保目录存在
      await this.ensureDirectoryExists(`/${WebDAVClient.DATA_FOLDER}`);

      const url = `/${WebDAVClient.DATA_FOLDER}/${encodeURIComponent(fileName)}`;
      await this.put(url, data, {
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      });
    } catch (error) {
      console.error(`[WebDAVClient] Failed to put file ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * 获取服务器时间
   */
  async getServerTime(): Promise<Date> {
    try {
      // WebDAV PROPFIND 请求获取根目录属性
      const response = await this.client.request({
        method: 'PROPFIND',
        url: '/',
        headers: {
          Depth: '0',
        },
      });

      // 尝试从响应头获取时间
      const dateHeader = response.headers['date'];
      if (dateHeader) {
        return new Date(dateHeader);
      }

      return new Date();
    } catch (error) {
      console.error('[WebDAVClient] Failed to get server time:', error);
      return new Date();
    }
  }

  /**
   * 获取服务器版本
   */
  async getVersion(): Promise<string> {
    try {
      // WebDAV 通常会在响应头中包含服务器信息
      const response = await this.client.options('/');
      const serverHeader = response.headers['server'];
      return serverHeader || 'Unknown WebDAV Server';
    } catch (error) {
      console.error('[WebDAVClient] Failed to get version:', error);
      return 'Unknown WebDAV Server';
    }
  }

  /**
   * 获取服务器信息
   */
  async getServerInfo(): Promise<ServerInfo> {
    try {
      const [version, serverTime] = await Promise.all([this.getVersion(), this.getServerTime()]);

      return {
        version,
        serverTime,
        online: true,
      };
    } catch (error) {
      console.error('[WebDAVClient] Failed to get server info:', error);
      return {
        version: 'Unknown',
        serverTime: new Date(),
        online: false,
      };
    }
  }

  /**
   * 确保目录存在（创建目录）
   */
  private async ensureDirectoryExists(path: string): Promise<void> {
    try {
      // 使用 MKCOL 方法创建目录
      // 如果目录已存在，会返回 405 Method Not Allowed，这是正常的
      await this.client.request({
        method: 'MKCOL',
        url: path,
      });
    } catch (error: any) {
      // 405 或 409 表示目录已存在，忽略这个错误
      if (error.response?.status === 405 || error.response?.status === 409) {
        return;
      }
      // 其他错误抛出
      throw error;
    }
  }

  /**
   * 列出目录内容
   */
  async listDirectory(path: string = '/'): Promise<string[]> {
    try {
      await this.client.request({
        method: 'PROPFIND',
        url: path,
        headers: {
          Depth: '1',
        },
      });

      // 解析 WebDAV XML 响应
      // 简化处理，实际应该使用 XML 解析器
      const files: string[] = [];
      // TODO: 实现 XML 解析逻辑
      return files;
    } catch (error) {
      console.error(`[WebDAVClient] Failed to list directory ${path}:`, error);
      throw error;
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(fileName: string): Promise<void> {
    if (!fileName) {
      throw new ValidationError('File name is required');
    }

    try {
      const url = `/${WebDAVClient.DATA_FOLDER}/${encodeURIComponent(fileName)}`;
      await this.delete(url);
    } catch (error) {
      console.error(`[WebDAVClient] Failed to delete file ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * 验证 ProfileDto 数据
   */
  private validateProfile(profile: ProfileDto): void {
    if (!profile) {
      throw new ValidationError('Profile is required');
    }

    if (!profile.type) {
      throw new ValidationError('Profile type is required');
    }

    const validTypes = ['Text', 'Image', 'File', 'Group'];
    if (!validTypes.includes(profile.type)) {
      throw new ValidationError(`Invalid profile type: ${profile.type}`);
    }

    if (typeof profile.text !== 'string') {
      throw new ValidationError('Profile text must be a string');
    }

    if (typeof profile.hasData !== 'boolean') {
      throw new ValidationError('Profile hasData must be a boolean');
    }

    if (profile.hasData && !profile.dataName) {
      throw new ValidationError('Profile dataName is required when hasData is true');
    }
  }

  /**
   * 测试 WebDAV 连接
   */
  async testConnection(): Promise<boolean> {
    // 使用 OPTIONS 请求测试连接
    await this.client.options('/');
    return true;
  }
}
