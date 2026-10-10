import {
  initializeAppFoundation,
  isAppFoundationReady,
  setAppLanguage,
} from '../services/AppFoundation';
import { initializeRuntimeLanguage, setRuntimeLanguage } from '../services/RuntimeLanguage';

jest.mock('../services/RuntimeLanguage', () => ({
  initializeRuntimeLanguage: jest.fn(),
  setRuntimeLanguage: jest.fn(),
}));

it('初始化失败可重试；并发入口复用一次初始化，用户切换等待其完成', async () => {
  (initializeRuntimeLanguage as jest.Mock).mockRejectedValueOnce(new Error('init failed'));
  await expect(initializeAppFoundation()).rejects.toThrow('init failed');
  expect(isAppFoundationReady()).toBe(false);
  let finish!: () => void;
  (initializeRuntimeLanguage as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const ui = initializeAppFoundation();
  const headless = initializeAppFoundation();
  const change = setAppLanguage('en');
  expect(ui).toBe(headless);
  expect(setRuntimeLanguage).not.toHaveBeenCalled();
  finish();
  await Promise.all([ui, headless, change]);
  expect(isAppFoundationReady()).toBe(true);
  expect(setRuntimeLanguage).toHaveBeenCalledWith('en');
  expect(initializeAppFoundation()).toBe(ui);
  expect(initializeRuntimeLanguage).toHaveBeenCalledTimes(2);
});
