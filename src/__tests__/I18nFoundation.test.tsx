import React from 'react';
// @ts-expect-error React Native 的 Jest 依赖提供 renderer，但未附带类型声明。
import TestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import i18n from '../i18n';
import { I18nProvider } from '../contexts/I18nContext';
import { useI18n } from '../hooks/useI18n';
import { initializeAppFoundation, setAppLanguage } from '../services/AppFoundation';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
  useLocales: () => [{ languageCode: 'en' }],
}));

it('UI 等待基础初始化，首次显示正确语言，多入口不重复初始化且切换共享', async () => {
  const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const originalActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT;
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  const seen: string[] = [];
  let selectLanguage!: ReturnType<typeof useI18n>['setLanguage'];
  function Content() {
    const { resolvedLanguage, setLanguage } = useI18n();
    selectLanguage = setLanguage;
    seen.push(resolvedLanguage);
    return React.createElement('text', null, i18n.t('common.uploaded', { preview: 'abc' }));
  }
  let resolveLanguage!: (language: string) => void;
  (AsyncStorage.getItem as jest.Mock).mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolveLanguage = resolve;
      })
  );
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  await i18n.changeLanguage('en');
  const changeLanguage = jest.spyOn(i18n, 'changeLanguage');
  let root: ReturnType<typeof TestRenderer.create>;
  let secondRoot: ReturnType<typeof TestRenderer.create>;
  try {
    await act(async () => {
      root = TestRenderer.create(
        <I18nProvider>
          <Content />
        </I18nProvider>
      );
    });
    expect(root.toJSON()).toBeNull();
    expect(seen).toEqual([]);
    const headless = initializeAppFoundation();
    await act(async () => {
      resolveLanguage('zh');
      await headless;
    });
    expect(root.toJSON().children).toEqual(['已上传\nabc']);
    expect(seen.every((language) => language === 'zh')).toBe(true);
    await act(async () => {
      secondRoot = TestRenderer.create(
        <I18nProvider>
          <Content />
        </I18nProvider>
      );
    });
    expect(secondRoot.toJSON().children).toEqual(['已上传\nabc']);
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
    expect(changeLanguage).toHaveBeenCalledTimes(1);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
      await act(async () => {
        await selectLanguage('en');
      });
      expect(alert).toHaveBeenCalledWith('设置失败', '操作失败，请重试');
      expect(root.toJSON().children).toEqual(['已上传\nabc']);
    } finally {
      alert.mockRestore();
      logError.mockRestore();
    }
    await act(async () => {
      await setAppLanguage('en');
    });
    expect(root.toJSON().children).toEqual([i18n.t('common.uploaded', { preview: 'abc' })]);
    expect(secondRoot.toJSON()).toEqual(root.toJSON());
    await initializeAppFoundation();
    expect(i18n.language).toBe('en');
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
    expect(changeLanguage).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => {
      root?.unmount();
      secondRoot?.unmount();
    });
    changeLanguage.mockRestore();
    testGlobal.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  }
});
