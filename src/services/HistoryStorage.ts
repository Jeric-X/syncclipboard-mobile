/**
 * History Storage Service
 * 历史记录存储服务 - 管理剪贴板历史记录
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ClipboardItem } from '../types/clipboard';
import { HistoryFilter, HistorySort, STORAGE_KEYS } from '../types/storage';
import { getHistoryFileDir } from '../utils/fileStorage';
import { File } from 'expo-file-system';

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
      // 从配置中读取最大历史记录条数
      try {
        const { configStorage } = await import('./ConfigStorage');
        const config = await configStorage.getConfig();
        if (config?.maxHistoryItems) {
          this.maxHistorySize = config.maxHistoryItems;
        }
      } catch (error) {
        console.warn('[HistoryStorage] Failed to load maxHistoryItems from config:', error);
      }

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

    // 处理文件复制逻辑
    let processedItem = { ...item };

    // 检查是否有文件数据且需要复制
    if (
      processedItem.hasData &&
      processedItem.fileUri &&
      processedItem.profileHash &&
      processedItem.dataName
    ) {
      try {
        // 获取历史记录目录
        const historyDir = getHistoryFileDir(processedItem.type, processedItem.profileHash);
        const historyDirUri = historyDir.uri;

        // 检查文件是否已经在历史记录目录中
        if (!processedItem.fileUri.startsWith(historyDirUri)) {
          // 读取源文件数据
          const sourceFile = new File(processedItem.fileUri);
          if (sourceFile.exists) {
            // 获取历史记录目录
            const historyDir = getHistoryFileDir(processedItem.type, processedItem.profileHash);

            // 确保历史记录目录存在
            if (!historyDir.exists) {
              historyDir.create();
            }

            // 创建目标文件
            const targetFile = new File(historyDir, processedItem.dataName);
            if (!targetFile.exists) {
              sourceFile.copy(targetFile);
            }

            // 更新 fileUri 为新的路径
            processedItem.fileUri = targetFile.uri;
            console.log('[HistoryStorage] File copied to history directory:', targetFile.uri);
          }
        }
      } catch (error) {
        console.error('[HistoryStorage] Failed to copy file to history directory:', error);
        // 继续执行，不阻止历史记录添加
      }
    }

    // 检查是否已存在相同 hash 的记录（不区分大小写）
    const existingIndex = this.history.findIndex(
      (h) => h.profileHash.toLowerCase() === processedItem.profileHash.toLowerCase()
    );

    if (existingIndex >= 0) {
      // 更新现有记录
      this.history[existingIndex] = {
        ...this.history[existingIndex],
        ...processedItem,
        timestamp: Date.now(),
      };
    } else {
      // 添加新记录
      this.history.unshift({
        ...processedItem,
        timestamp: processedItem.timestamp || Date.now(),
      });

      // 限制历史记录大小
      if (this.history.length > this.maxHistorySize) {
        this.history = this.history.slice(0, this.maxHistorySize);
      }
    }

    await this.saveHistory();
  }

  /**
   * 批量添加历史记录
   */
  public async addItems(items: ClipboardItem[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    for (const item of items) {
      const existingIndex = this.history.findIndex(
        (h) => h.profileHash.toLowerCase() === item.profileHash.toLowerCase()
      );

      if (existingIndex >= 0) {
        this.history[existingIndex] = {
          ...this.history[existingIndex],
          ...item,
          timestamp: Date.now(),
        };
      } else {
        this.history.unshift({
          ...item,
          timestamp: item.timestamp || Date.now(),
        });
      }
    }

    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(0, this.maxHistorySize);
    }

    await this.saveHistory();
  }

  /**
   * 根据 profileHash 获取历史记录
   */
  public async getItem(profileHash: string): Promise<ClipboardItem | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    return (
      this.history.find((item) => item.profileHash.toLowerCase() === profileHash.toLowerCase()) ||
      null
    );
  }

  /**
   * 根据 localClipboardHash 获取历史记录
   */
  public async getItemByLocalHash(localClipboardHash: string): Promise<ClipboardItem | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.history.find((item) => item.localClipboardHash === localClipboardHash) || null;
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
  public async updateItem(profileHash: string, updates: Partial<ClipboardItem>): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const index = this.history.findIndex(
      (item) => item.profileHash.toLowerCase() === profileHash.toLowerCase()
    );

    if (index >= 0) {
      this.history[index] = { ...this.history[index], ...updates };
      await this.saveHistory();
    } else {
      throw new Error(`History item not found: ${profileHash}`);
    }
  }

  /**
   * 删除历史记录项
   */
  public async deleteItem(profileHash: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const index = this.history.findIndex(
      (item) => item.profileHash.toLowerCase() === profileHash.toLowerCase()
    );

    if (index >= 0) {
      const item = this.history[index];
      this.history.splice(index, 1);
      await this.saveHistory();

      // 删除对应的历史记录文件夹
      try {
        const { deleteHistoryFileDir } = await import('../utils/fileStorage');
        if (item.type && item.profileHash) {
          await deleteHistoryFileDir(item.type, item.profileHash);
          console.log(
            '[HistoryStorage] History file directory deleted:',
            item.type,
            item.profileHash
          );
        }
      } catch (error) {
        console.error('[HistoryStorage] Failed to delete history file directory:', error);
      }
    }
  }

  /**
   * 批量删除历史记录
   */
  public async deleteItems(profileHashes: string[]): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    // 保存要删除的项目
    const itemsToDelete = this.history.filter((item) =>
      profileHashes.some((hash) => hash.toLowerCase() === item.profileHash.toLowerCase())
    );

    // 从历史记录中过滤掉要删除的项目
    this.history = this.history.filter(
      (item) => !profileHashes.some((hash) => hash.toLowerCase() === item.profileHash.toLowerCase())
    );
    await this.saveHistory();

    // 批量删除对应的历史记录文件夹
    try {
      const { deleteHistoryFileDir } = await import('../utils/fileStorage');
      for (const item of itemsToDelete) {
        if (item.type && item.profileHash) {
          try {
            await deleteHistoryFileDir(item.type, item.profileHash);
            console.log(
              '[HistoryStorage] History file directory deleted:',
              item.type,
              item.profileHash
            );
          } catch (error) {
            console.error(
              '[HistoryStorage] Failed to delete history file directory:',
              item.type,
              item.profileHash,
              error
            );
          }
        }
      }
    } catch (error) {
      console.error('[HistoryStorage] Failed to delete history file directories:', error);
    }
  }

  /**
   * 标记/取消标记历史记录
   */
  public async toggleStar(profileHash: string): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }

    const index = this.history.findIndex(
      (item) => item.profileHash.toLowerCase() === profileHash.toLowerCase()
    );

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
  public async incrementUseCount(profileHash: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const index = this.history.findIndex(
      (item) => item.profileHash.toLowerCase() === profileHash.toLowerCase()
    );

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
    // 清空内存中的历史记录
    this.history = [];
    // 从AsyncStorage中移除历史记录
    await AsyncStorage.removeItem(STORAGE_KEYS.HISTORY);

    // 删除历史记录文件夹下的所有文件
    try {
      const { initFileStorage } = await import('../utils/fileStorage');
      await initFileStorage();

      const { HISTORY_BASE_DIR } = await import('../utils/fileStorage');
      if (HISTORY_BASE_DIR.exists) {
        const entries = HISTORY_BASE_DIR.list();
        for (const entry of entries) {
          try {
            entry.delete();
          } catch (error) {
            console.error('[HistoryStorage] Failed to delete history entry:', error);
          }
        }
        console.log('[HistoryStorage] History files cleared');
      }
    } catch (error) {
      console.error('[HistoryStorage] Failed to clear history files:', error);
    }
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
