/** 将 UpdateService 的发布订阅状态桥接为 React 可消费的 Zustand store。 */

import { create } from 'zustand';
import { updateService, type UpdateServiceState } from '@/services/update';

export const useUpdateServiceStore = create<UpdateServiceState>(() => updateService.getState());

updateService.subscribe((state) => {
  useUpdateServiceStore.setState(state);
});
