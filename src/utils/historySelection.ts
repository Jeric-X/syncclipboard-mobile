/**
 * 更新指定分类范围内的历史记录选择状态。
 *
 * @param selectedIds 当前已选中的全部记录 ID
 * @param scopedIds 当前分类内的记录 ID
 * @param selected 是否选中当前分类
 * @returns 更新后的选择集合
 */
export function updateScopedSelection(
  selectedIds: ReadonlySet<string>,
  scopedIds: Iterable<string>,
  selected: boolean
): Set<string> {
  const nextSelectedIds = new Set(selectedIds);
  for (const id of scopedIds) {
    if (selected) {
      nextSelectedIds.add(id);
    } else {
      nextSelectedIds.delete(id);
    }
  }
  return nextSelectedIds;
}
