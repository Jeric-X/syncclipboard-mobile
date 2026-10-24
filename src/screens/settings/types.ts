import type { useMessageToast } from '@/hooks/useMessageToast';

/** 设置模块共用页面级消息提示，避免各模块重复渲染 Toast。 */
export interface SettingsModuleProps {
  showMessage: ReturnType<typeof useMessageToast>['showMessage'];
}
