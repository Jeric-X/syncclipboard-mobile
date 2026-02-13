/**
 * SignalR Client Service
 * SignalR 客户端服务 - 用于与 SyncClipboard 服务器实时通信
 */

import * as SignalR from '@microsoft/signalr';
import { ServerConfig, ProfileDto } from '@/types/api';

export interface RemoteClipboardChangedCallback {
  (profile: ProfileDto): void;
}

export interface RemoteHistoryChangedCallback {
  (historyRecord: any): void;
}

/**
 * SignalR 客户端类
 */
export class SignalRClient {
  private connection: SignalR.HubConnection | null = null;
  private serverConfig: ServerConfig | null = null;
  private remoteClipboardCallbacks: Set<RemoteClipboardChangedCallback> = new Set();
  private remoteHistoryCallbacks: Set<RemoteHistoryChangedCallback> = new Set();
  private isConnecting = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  /**
   * 连接到 SignalR Hub
   */
  async connect(serverConfig: ServerConfig): Promise<void> {
    if (serverConfig.type !== 'syncclipboard') {
      throw new Error('SignalR is only supported for SyncClipboard server type');
    }

    // 如果已经连接到同一个服务器，不重复连接
    if (this.connection && this.serverConfig?.url === serverConfig.url) {
      if (this.connection.state === SignalR.HubConnectionState.Connected) {
        console.log('[SignalRClient] Already connected to', serverConfig.url);
        return;
      }
    }

    // 断开现有连接
    await this.disconnect();

    this.serverConfig = serverConfig;
    this.isConnecting = true;

    try {
      // 构建 Hub URL
      const hubUrl = this.buildHubUrl(serverConfig.url);

      console.log('[SignalRClient] Connecting to SignalR hub:', hubUrl);

      // 创建连接
      const connectionBuilder = new SignalR.HubConnectionBuilder()
        .withUrl(hubUrl, {
          // 添加 Basic Authentication header
          headers: this.getAuthHeaders(serverConfig),
          skipNegotiation: false,
        })
        .withAutomaticReconnect({
          nextRetryDelayInMilliseconds: (retryContext) => {
            if (retryContext.previousRetryCount >= this.maxReconnectAttempts) {
              return null; // 停止重连
            }
            // 指数退避: 2s, 4s, 8s, 16s, 32s
            return Math.min(2000 * Math.pow(2, retryContext.previousRetryCount), 32000);
          },
        })
        .configureLogging(SignalR.LogLevel.Information);

      this.connection = connectionBuilder.build();

      // 注册服务器端调用的方法
      this.registerHandlers();

      // 注册连接事件
      this.registerConnectionEvents();

      // 开始连接
      await this.connection.start();

      this.reconnectAttempts = 0;
      this.isConnecting = false;

      console.log('[SignalRClient] Connected successfully');
    } catch (error) {
      this.isConnecting = false;
      console.error('[SignalRClient] Failed to connect:', error);
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.stop();
        console.log('[SignalRClient] Disconnected');
      } catch (error) {
        console.error('[SignalRClient] Error during disconnect:', error);
      }
      this.connection = null;
    }
    this.serverConfig = null;
    this.isConnecting = false;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connection?.state === SignalR.HubConnectionState.Connected;
  }

  /**
   * 获取连接状态
   */
  getConnectionState(): SignalR.HubConnectionState | null {
    return this.connection?.state || null;
  }

  /**
   * 添加远程剪贴板变化回调
   */
  onRemoteClipboardChanged(callback: RemoteClipboardChangedCallback): void {
    this.remoteClipboardCallbacks.add(callback);
  }

  /**
   * 移除远程剪贴板变化回调
   */
  offRemoteClipboardChanged(callback: RemoteClipboardChangedCallback): void {
    this.remoteClipboardCallbacks.delete(callback);
  }

  /**
   * 添加远程历史变化回调
   */
  onRemoteHistoryChanged(callback: RemoteHistoryChangedCallback): void {
    this.remoteHistoryCallbacks.add(callback);
  }

  /**
   * 移除远程历史变化回调
   */
  offRemoteHistoryChanged(callback: RemoteHistoryChangedCallback): void {
    this.remoteHistoryCallbacks.delete(callback);
  }

  /**
   * 清除所有回调
   */
  clearCallbacks(): void {
    this.remoteClipboardCallbacks.clear();
    this.remoteHistoryCallbacks.clear();
  }

  /**
   * 注册服务器端调用的方法处理器
   */
  private registerHandlers(): void {
    if (!this.connection) return;

    // 远程剪贴板变化
    this.connection.on('RemoteProfileChanged', (profile: ProfileDto) => {
      console.log('[SignalRClient] Remote clipboard changed:', profile.type);
      this.remoteClipboardCallbacks.forEach((callback) => {
        try {
          callback(profile);
        } catch (error) {
          console.error('[SignalRClient] Error in clipboard callback:', error);
        }
      });
    });

    // 远程历史变化
    this.connection.on('RemoteHistoryChanged', (historyRecord: any) => {
      console.log('[SignalRClient] Remote history changed');
      this.remoteHistoryCallbacks.forEach((callback) => {
        try {
          callback(historyRecord);
        } catch (error) {
          console.error('[SignalRClient] Error in history callback:', error);
        }
      });
    });
  }

  /**
   * 注册连接事件
   */
  private registerConnectionEvents(): void {
    if (!this.connection) return;

    this.connection.onreconnecting((error) => {
      console.log('[SignalRClient] Reconnecting...', error);
      this.reconnectAttempts++;
    });

    this.connection.onreconnected((connectionId) => {
      console.log('[SignalRClient] Reconnected. Connection ID:', connectionId);
      this.reconnectAttempts = 0;
    });

    this.connection.onclose((error) => {
      console.log('[SignalRClient] Connection closed', error);

      if (error && this.reconnectAttempts < this.maxReconnectAttempts) {
        // 如果是意外断开，尝试重连
        console.log('[SignalRClient] Will attempt to reconnect...');
      }
    });
  }

  /**
   * 构建 Hub URL
   */
  private buildHubUrl(serverUrl: string): string {
    // 移除末尾的斜杠
    const baseUrl = serverUrl.replace(/\/$/, '');
    return `${baseUrl}/SyncClipboardHub`;
  }

  /**
   * 获取认证 Headers
   */
  private getAuthHeaders(serverConfig: ServerConfig): Record<string, string> {
    if (!serverConfig.username || !serverConfig.password) {
      return {};
    }

    // 使用 Basic Authentication
    const credentials = `${serverConfig.username}:${serverConfig.password}`;
    const encodedCredentials = btoa(credentials);

    return {
      Authorization: `Basic ${encodedCredentials}`,
    };
  }
}

// 创建单例实例
let signalRClientInstance: SignalRClient | null = null;

/**
 * 获取 SignalR 客户端单例
 */
export function getSignalRClient(): SignalRClient {
  if (!signalRClientInstance) {
    signalRClientInstance = new SignalRClient();
  }
  return signalRClientInstance;
}

/**
 * 重置 SignalR 客户端（主要用于测试）
 */
export function resetSignalRClient(): void {
  if (signalRClientInstance) {
    signalRClientInstance.disconnect();
    signalRClientInstance = null;
  }
}
