/** Hugeicons 4.2.2 提供单图标 JS 子路径，但缺少 package exports 指向的类型文件。 */
declare module '@hugeicons/core-free-icons/*' {
  import type { FileEmpty02Icon } from '@hugeicons/core-free-icons';

  const icon: typeof FileEmpty02Icon;
  export default icon;
}
