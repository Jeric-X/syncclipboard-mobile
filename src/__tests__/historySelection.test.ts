import { updateScopedSelection } from '@/utils/historySelection';

describe('历史记录分类多选', () => {
  it('全选当前分类时保留其他分类已选中的记录', () => {
    const selectedIds = new Set(['text-1']);

    const result = updateScopedSelection(selectedIds, ['image-1', 'image-2'], true);

    expect([...result]).toEqual(['text-1', 'image-1', 'image-2']);
    expect([...selectedIds]).toEqual(['text-1']);
  });

  it('取消全选当前分类时只移除当前分类的记录', () => {
    const selectedIds = new Set(['text-1', 'image-1', 'image-2']);

    const result = updateScopedSelection(selectedIds, ['image-1', 'image-2'], false);

    expect([...result]).toEqual(['text-1']);
    expect([...selectedIds]).toEqual(['text-1', 'image-1', 'image-2']);
  });
});
