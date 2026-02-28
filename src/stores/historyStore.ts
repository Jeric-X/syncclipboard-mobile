/**
 * History Store
 * 历史记录状态管理 - 使用 Zustand
 */

import { create } from 'zustand';
import { ClipboardItem } from '../types/clipboard';
import { HistoryFilter, HistorySort } from '../types/storage';
import { historyStorage } from '../services';

/**
 * 历史记录状态接口
 */
interface HistoryState {
  // 状态
  /** 历史记录列表 */
  items: ClipboardItem[];

  /** 总记录数 */
  totalCount: number;

  /** 当前页码 */
  currentPage: number;

  /** 每页大小 */
  pageSize: number;

  /** 当前过滤器 */
  filter: HistoryFilter | null;

  /** 当前排序 */
  sort: HistorySort | null;

  /** 是否正在加载 */
  isLoading: boolean;

  /** 错误信息 */
  error: string | null;

  /** 选中的项目ID */
  selectedIds: Set<string>;

  /** 最后添加项目的时间戳 */
  lastAddedTimestamp: number;

  // 动作
  /** 加载历史记录 */
  loadItems: (page?: number) => Promise<void>;

  /** 搜索历史记录 */
  searchItems: (filter?: HistoryFilter, sort?: HistorySort) => Promise<void>;

  /** 添加历史记录 */
  addItem: (item: ClipboardItem) => Promise<void>;

  /** 更新历史记录 */
  updateItem: (id: string, updates: Partial<ClipboardItem>) => Promise<void>;

  /** 删除历史记录 */
  deleteItem: (id: string) => Promise<void>;

  /** 批量删除 */
  deleteItems: (ids: string[]) => Promise<void>;

  /** 切换标记 */
  toggleStar: (id: string) => Promise<void>;

  /** 增加使用次数 */
  incrementUseCount: (id: string) => Promise<void>;

  /** 清空历史记录 */
  clearHistory: () => Promise<void>;

  /** 设置页面大小 */
  setPageSize: (size: number) => void;

  /** 设置过滤器 */
  setFilter: (filter: HistoryFilter | null) => void;

  /** 设置排序 */
  setSort: (sort: HistorySort | null) => void;

  /** 切换选中 */
  toggleSelection: (id: string) => void;

  /** 全选 */
  selectAll: () => void;

  /** 取消全选 */
  clearSelection: () => void;

  /** 删除选中项 */
  deleteSelected: () => Promise<void>;

  /** 清除错误 */
  clearError: () => void;

  /** 刷新 */
  refresh: () => Promise<void>;

  /** 重置 */
  reset: () => void;
}

/**
 * 初始状态
 */
const initialState = {
  items: [],
  totalCount: 0,
  currentPage: 1,
  pageSize: 20,
  filter: null,
  sort: null,
  isLoading: false,
  error: null,
  selectedIds: new Set<string>(),
  lastAddedTimestamp: 0,
};

/**
 * 创建历史记录 Store
 */
export const useHistoryStore = create<HistoryState>((set, get) => ({
  ...initialState,

  loadItems: async (page = 1) => {
    set({ isLoading: true, error: null });

    try {
      const { pageSize, filter, sort } = get();

      if (filter || sort) {
        const result = await historyStorage.searchItems(
          filter || undefined,
          sort || undefined,
          page,
          pageSize
        );
        set((state) => ({
          items: page === 1 ? result.items : [...state.items, ...result.items],
          totalCount: result.total,
          currentPage: page,
          isLoading: false,
        }));
      } else {
        const newItems = await historyStorage.getItems(page, pageSize);
        const totalCount = await historyStorage.getCount();
        set((state) => ({
          items: page === 1 ? newItems : [...state.items, ...newItems],
          totalCount,
          currentPage: page,
          isLoading: false,
        }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load history';
      set({ error: errorMessage, isLoading: false });
    }
  },

  searchItems: async (filter, sort) => {
    set({ isLoading: true, error: null, filter, sort, currentPage: 1 });

    try {
      const { pageSize } = get();
      const result = await historyStorage.searchItems(filter, sort, 1, pageSize);

      set({
        items: result.items,
        totalCount: result.total,
        isLoading: false,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to search history';
      set({ error: errorMessage, isLoading: false });
    }
  },

  addItem: async (item: ClipboardItem) => {
    set({ error: null });

    try {
      await historyStorage.addItem(item);

      // 更新最后添加时间戳
      set({ lastAddedTimestamp: Date.now() });

      // 刷新当前页
      await get().refresh();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to add item';
      set({ error: errorMessage });
    }
  },

  updateItem: async (profileHash: string, updates: Partial<ClipboardItem>) => {
    set({ error: null });

    try {
      await historyStorage.updateItem(profileHash, updates);

      // 更新本地状态
      set((state) => ({
        items: state.items.map((item) =>
          item.profileHash === profileHash ? { ...item, ...updates } : item
        ),
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update item';
      set({ error: errorMessage });
    }
  },

  deleteItem: async (profileHash: string) => {
    set({ error: null });

    try {
      await historyStorage.deleteItem(profileHash);

      // 更新本地状态
      set((state) => ({
        items: state.items.filter((item) => item.profileHash !== profileHash),
        totalCount: state.totalCount - 1,
        selectedIds: new Set(
          [...state.selectedIds].filter((selectedId) => selectedId !== profileHash)
        ),
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete item';
      set({ error: errorMessage });
    }
  },

  deleteItems: async (profileHashes: string[]) => {
    set({ error: null });

    try {
      await historyStorage.deleteItems(profileHashes);

      // 更新本地状态
      set((state) => ({
        items: state.items.filter((item) => !profileHashes.includes(item.profileHash)),
        totalCount: state.totalCount - profileHashes.length,
        selectedIds: new Set(
          [...state.selectedIds].filter((profileHash) => !profileHashes.includes(profileHash))
        ),
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete items';
      set({ error: errorMessage });
    }
  },

  toggleStar: async (profileHash: string) => {
    set({ error: null });

    try {
      const starred = await historyStorage.toggleStar(profileHash);

      // 更新本地状态
      set((state) => ({
        items: state.items.map((item) =>
          item.profileHash === profileHash ? { ...item, starred } : item
        ) as ClipboardItem[],
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to toggle star';
      set({ error: errorMessage });
    }
  },

  incrementUseCount: async (profileHash: string) => {
    try {
      await historyStorage.incrementUseCount(profileHash);

      // 更新本地状态（可选）
      set((state) => ({
        items: state.items.map((item) => {
          if (item.profileHash === profileHash) {
            const useCount = (item.useCount || 0) + 1;
            return { ...item, useCount };
          }
          return item;
        }),
      }));
    } catch (error) {
      // 静默失败，不影响用户体验
      console.error('Failed to increment use count:', error);
    }
  },

  clearHistory: async () => {
    set({ isLoading: true, error: null });

    try {
      await historyStorage.clear();
      set({
        items: [],
        totalCount: 0,
        currentPage: 1,
        selectedIds: new Set(),
        isLoading: false,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to clear history';
      set({ error: errorMessage, isLoading: false });
    }
  },

  setPageSize: (size: number) => {
    set({ pageSize: size, currentPage: 1 });
    get().loadItems(1);
  },

  setFilter: (filter: HistoryFilter | null) => {
    set({ filter });
  },

  setSort: (sort: HistorySort | null) => {
    set({ sort });
  },

  toggleSelection: (id: string) => {
    set((state) => {
      const newSelectedIds = new Set(state.selectedIds);
      if (newSelectedIds.has(id)) {
        newSelectedIds.delete(id);
      } else {
        newSelectedIds.add(id);
      }
      return { selectedIds: newSelectedIds };
    });
  },

  selectAll: () => {
    set((state) => ({
      selectedIds: new Set(state.items.map((item) => item.profileHash)),
    }));
  },

  clearSelection: () => {
    set({ selectedIds: new Set() });
  },

  deleteSelected: async () => {
    const { selectedIds } = get();
    if (selectedIds.size > 0) {
      await get().deleteItems([...selectedIds]);
    }
  },

  clearError: () => {
    set({ error: null });
  },

  refresh: async () => {
    await get().loadItems(1);
  },

  reset: () => {
    set(initialState);
  },
}));
