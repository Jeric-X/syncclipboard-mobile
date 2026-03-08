/**
 * History Storage Service
 * 历史记录存储服务 - 管理剪贴板历史记录
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ClipboardItem } from '../types/clipboard';
import { HistoryFilter, HistorySort, STORAGE_KEYS } from '../types/storage';

/**
 * 历史记录存储服务
 */
export class HistoryStorage {
  private static instance: HistoryStorage | null = null;
  private history: ClipboardItem[] = [];
  private initialized = false;
  private maxHistorySize = 1000; // 最多保存 1000 条历史记录

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): HistoryStorage {
    if (!HistoryStorage.instance) {
      HistoryStorage.instance = new HistoryStorage();
    }
    return HistoryStorage.instance;
  }

  /**
   * 初始化历史记录存储
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.loadHistory();
      this.initialized = true;
    } catch (error) {
      console.error('[HistoryStorage] Failed to initialize:', error);
      this.history = [];
      this.initialized = true;
    }
  }

  /**
   * 加载历史记录
   */
  private async loadHistory(): Promise<void> {
    const historyJson = await AsyncStorage.getItem(STORAGE_KEYS.HISTORY);

    if (historyJson) {
      this.history = JSON.parse(historyJson);
    } else {
      this.history = [];
    }
  }

  /**
   * 保存历史记录
   */
  private async saveHistory(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(this.history));
    } catch (error) {
      console.error('[HistoryStorage] Failed to save history:', error);
      throw error;
    }
  }

  /**
   * 添加历史记录
   */
  public async addItem(item: ClipboardItem): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    // 检查是否已存在相同 hash 的记录
    const existingIndex = this.history.findIndex((h) => h.profileHash === item.profileHash);

    if (existingIndex >= 0) {
      // 更新现有记录
      this.history[existingIndex] = {
        ...this.history[existingIndex],
        ...item,
        timestamp: Date.now(),
      };
    } else {
      // 添加新记录
      this.history.unshift({
        ...item,
        timestamp: item.timestamp || Date.now(),
      });

      // 限制历史记录大小
      if (this.history.length > this.maxHistorySize) {
        this.history = this.history.slice(0, this.maxHistorySize);
      }
    }

    await this.saveHistory();
  }

  /**
   * 获取历史记录项
   */
  public async getItem(id: string): Promise<ClipboardItem | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.history.find((item) => item.id === id) || null;
  }

  /**
   * 获取所有历史记录
   */
  public async getAllItems(): Promise<ClipboardItem[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    return [...this.history];
  }

  /**
   * 获取分页历史记录
   */
  public async getItems(page: number = 1, pageSize: number = 20): Promise<ClipboardItem[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return this.history.slice(start, end);
  }

  /**
   * 搜索和过滤历史记录
   */
  public async searchItems(
    filter?: HistoryFilter,
    sort?: HistorySort,
    page: number = 1,
    pageSize: number = 20
  ): Promise<{ items: ClipboardItem[]; total: number }> {
    if (!this.initialized) {
      await this.initialize();
    }

    let filtered = [...this.history];

    // 应用过滤器
    if (filter) {
      if (filter.type && filter.type.length > 0) {
        filtered = filtered.filter((item) => filter.type!.includes(item.type));
      }

      if (filter.startDate) {
        filtered = filtered.filter((item) => item.timestamp >= filter.startDate!);
      }

      if (filter.endDate) {
        filtered = filtered.filter((item) => item.timestamp <= filter.endDate!);
      }

      if (filter.keyword) {
        const keyword = filter.keyword.toLowerCase();
        filtered = filtered.filter(
          (item) =>
            item.text.toLowerCase().includes(keyword) ||
            (item.dataName && item.dataName.toLowerCase().includes(keyword))
        );
      }

      if (filter.starredOnly) {
        filtered = filtered.filter((item) => item.starred === true);
      }

      if (filter.syncedOnly) {
        filtered = filtered.filter((item) => item.synced === true);
      }
    }

    // 应用排序
    if (sort) {
      filtered.sort((a, b) => {
        let compareResult = 0;

        switch (sort.field) {
          case 'timestamp':
            compareResult = a.timestamp - b.timestamp;
            break;
          case 'useCount':
            compareResult = (a.useCount || 0) - (b.useCount || 0);
            break;
          case 'size':
            compareResult = (a.size || 0) - (b.size || 0);
            break;
        }

        return sort.order === 'desc' ? -compareResult : compareResult;
      });
    }

    // 分页
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return {
      items: filtered.slice(start, end),
      total: filtered.length,
    };
  }

  /**
   * 更新历史记录项
   */
  public async updateItem(id: string, updates: Partial<ClipboardItem>): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const index = this.history.findIndex((item) => item.id === id);

    if (index >= 0) {
      this.history[index] = { ...this.history[index], ...updates };
      await this.saveHistory();
    } else {
      throw new Error(`History item not found: ${id}`);
    }
  }

  /**
   * 删除历史记录项
   */
  public async deleteItem(id: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const index = this.history.findIndex((item) => item.id === id);

    if (index >= 0) {
      this.history.splice(index, 1);
      await this.saveHistory();
    }
  }

  /**
   * 批量删除历史记录
   */
  public async deleteItems(ids: string[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.history = this.history.filter((item) => !ids.includes(item.id));
    await this.saveHistory();
  }

  /**
   * 标记/取消标记历史记录
   */
  public async toggleStar(id: string): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }

    const index = this.history.findIndex((item) => item.id === id);

    if (index >= 0) {
      const item = this.history[index];
      item.starred = !item.starred;
      await this.saveHistory();
      return item.starred;
    }

    return false;
  }

  /**
   * 增加使用次数
   */
  public async incrementUseCount(id: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const index = this.history.findIndex((item) => item.id === id);

    if (index >= 0) {
      const item = this.history[index];
      item.useCount = (item.useCount || 0) + 1;
      await this.saveHistory();
    }
  }

  /**
   * 获取历史记录数量
   */
  public async getCount(): Promise<number> {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.history.length;
  }

  /**
   * 获取历史记录统计信息
   */
  public async getStats(): Promise<{
    total: number;
    byType: Record<string, number>;
    totalSize: number;
    starred: number;
    synced: number;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const stats = {
      total: this.history.length,
      byType: {} as Record<string, number>,
      totalSize: 0,
      starred: 0,
      synced: 0,
    };

    this.history.forEach((item) => {
      // 按类型统计
      stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;

      // 总大小
      if (item.size) {
        stats.totalSize += item.size;
      }

      // 标记数
      if (item.starred) {
        stats.starred++;
      }

      // 已同步数
      if (item.synced) {
        stats.synced++;
      }
    });

    return stats;
  }

  /**
   * 清空历史记录
   */
  public async clear(): Promise<void> {
    this.history = [];
    await AsyncStorage.removeItem(STORAGE_KEYS.HISTORY);
  }

  /**
   * 清空旧记录（保留最近的 N 条）
   */
  public async cleanOldItems(keepCount: number = 100): Promise<number> {
    if (!this.initialized) {
      await this.initialize();
    }

    const originalCount = this.history.length;

    if (originalCount > keepCount) {
      this.history = this.history.slice(0, keepCount);
      await this.saveHistory();
      return originalCount - keepCount;
    }

    return 0;
  }

  /**
   * 设置最大历史记录大小
   */
  public setMaxHistorySize(size: number): void {
    if (size < 10) {
      throw new Error('Max history size must be at least 10');
    }
    this.maxHistorySize = size;
  }
}

// 导出单例
export const historyStorage = HistoryStorage.getInstance();
