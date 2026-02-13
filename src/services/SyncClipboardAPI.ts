/**
 * SyncClipboard API Client
 * Implements SyncClipboard server API operations
 */

import { APIClient, APIClientConfig } from './APIClient';
import { ProfileDto, ServerInfo } from '../types/api';
import { ValidationError } from './errors';

/**
 * SyncClipboard API 接口
 */
export interface ISyncClipboardAPI {
  /** 获取剪贴板配置 */
  getClipboard(): Promise<ProfileDto>;

  /** 上传剪贴板配置 */
  putClipboard(profile: ProfileDto): Promise<void>;

  /** 获取文件数据 */
  getFile(fileName: string): Promise<Blob>;

  /** 上传文件数据 */
  putFile(fileName: string, data: Blob): Promise<void>;

  /** 获取服务器时间 */
  getServerTime(): Promise<Date>;

  /** 获取服务器版本 */
  getVersion(): Promise<string>;

  /** 获取服务器信息 */
  getServerInfo(): Promise<ServerInfo>;
}

/**
 * SyncClipboard API 客户端
 */
export class SyncClipboardAPI extends APIClient implements ISyncClipboardAPI {
  private static readonly PROFILE_ENDPOINT = '/SyncClipboard.json';
  private static readonly FILE_ENDPOINT = '/SyncClipboard/';

  constructor(config: APIClientConfig) {
    super(config);
  }

  /**
   * 获取剪贴板配置
   */
  async getClipboard(): Promise<ProfileDto> {
    try {
      const profile = await this.get<ProfileDto>(SyncClipboardAPI.PROFILE_ENDPOINT);

      // 验证响应数据
      this.validateProfile(profile);

      return profile;
    } catch (error) {
      console.error('[SyncClipboardAPI] Failed to get clipboard:', error);
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

      await this.put(SyncClipboardAPI.PROFILE_ENDPOINT, profile);
    } catch (error) {
      console.error('[SyncClipboardAPI] Failed to put clipboard:', error);
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
      const url = `${SyncClipboardAPI.FILE_ENDPOINT}${encodeURIComponent(fileName)}`;
      const blob = await this.get<Blob>(url, {
        responseType: 'blob',
      });

      return blob;
    } catch (error) {
      console.error(`[SyncClipboardAPI] Failed to get file ${fileName}:`, error);
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
      const url = `${SyncClipboardAPI.FILE_ENDPOINT}${encodeURIComponent(fileName)}`;
      await this.put(url, data, {
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      });
    } catch (error) {
      console.error(`[SyncClipboardAPI] Failed to put file ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * 获取服务器时间
   */
  async getServerTime(): Promise<Date> {
    // 尝试从响应头获取服务器时间
    const response = await this.client.head('/');
    const dateHeader = response.headers['date'];

    if (dateHeader) {
      return new Date(dateHeader);
    }

    // 如果没有 date 头，返回当前时间
    return new Date();
  }

  /**
   * 获取服务器版本
   */
  async getVersion(): Promise<string> {
    try {
      // 尝试获取版本信息（假设有 /version 端点）
      const version = await this.get<string>('/version').catch(() => 'Unknown');
      return version;
    } catch (error) {
      console.error('[SyncClipboardAPI] Failed to get version:', error);
      return 'Unknown';
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
      console.error('[SyncClipboardAPI] Failed to get server info:', error);
      return {
        version: 'Unknown',
        serverTime: new Date(),
        online: false,
      };
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
   * 测试 API 连接
   */
  async testConnection(): Promise<boolean> {
    // 直接调用 API 测试连接，不捕获错误
    await this.getServerTime();
    return true;
  }
}
