import { create } from 'zustand';
import { errorService } from '../services/ErrorService';
import type { ErrorInfo } from '../services/ErrorService';

interface ErrorState {
  error: ErrorInfo | null;

  setError: (error: ErrorInfo | null) => void;
  clearError: () => void;
  showNetworkError: (operation: string, detail?: string) => void;
}

export const useErrorStore = create<ErrorState>((set) => {
  // store 订阅 errorService，由 service 层驱动状态更新
  errorService.subscribe((error) => {
    set({ error });
  });

  return {
    error: null,

    setError: (error) => errorService.setError(error),

    clearError: () => errorService.clearError(),

    showNetworkError: (operation: string, detail?: string) =>
      errorService.showNetworkError(operation, detail),
  };
});
