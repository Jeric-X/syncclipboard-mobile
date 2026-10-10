import React from 'react';
// @ts-expect-error React Native 的 Jest 依赖提供 renderer，但未附带类型声明。
import TestRenderer, { act } from 'react-test-renderer';
import { I18nProvider } from '../contexts/I18nContext';
import { initializeAppFoundation } from '../services/AppFoundation';

jest.mock('../services/AppFoundation', () => ({
  initializeAppFoundation: jest.fn(),
  isAppFoundationReady: () => false,
}));
jest.mock('expo-localization', () => ({ useLocales: () => [{ languageCode: 'en' }] }));
jest.mock('../services/RuntimeLanguage', () => {
  const state = { language: 'zh', resolvedLanguage: 'zh', systemLanguage: 'en' };
  return {
    getRuntimeLanguageState: () => state,
    subscribeRuntimeLanguage: () => () => {},
    refreshRuntimeSystemLanguage: jest.fn().mockResolvedValue(undefined),
  };
});

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let originalActEnvironment: boolean | undefined;
let root: ReturnType<typeof TestRenderer.create>;

beforeEach(() => {
  originalActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT;
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useRealTimers();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (initializeAppFoundation as jest.Mock)
    .mockReset()
    .mockRejectedValueOnce(new Error('transient'))
    .mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  jest.useRealTimers();
  jest.restoreAllMocks();
  testGlobal.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
});

it('初始化瞬时失败后重试，已挂载的 UI 可以恢复', async () => {
  await act(async () => {
    root = TestRenderer.create(
      <I18nProvider>{React.createElement('text', null, '就绪')}</I18nProvider>
    );
  });
  expect(root.toJSON()).toBeNull();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });
  expect(root.toJSON()?.children).toEqual(['就绪']);
  expect(initializeAppFoundation).toHaveBeenCalledTimes(2);
});

it('Provider 卸载后取消待执行的重试', async () => {
  await act(async () => {
    root = TestRenderer.create(<I18nProvider>{null}</I18nProvider>);
  });
  await act(async () => {
    root.unmount();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });
  expect(initializeAppFoundation).toHaveBeenCalledTimes(1);
});
