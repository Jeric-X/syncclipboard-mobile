import { shouldEnableAutoUpdateCheck } from '@/utils/appLaunch';

describe('shouldEnableAutoUpdateCheck', () => {
  it.each([
    'syncclipboard://quick-upload',
    'syncclipboard://quick-upload?fg=1',
    'syncclipboard://quick-download',
    'syncclipboard://quick-download?fg=1',
    'syncclipboard://expo-sharing',
  ])('overlay 冷启动 %s 跳过更新检查', (url) => {
    expect(shouldEnableAutoUpdateCheck(url)).toBe(false);
  });

  it.each([null, 'syncclipboard://home', 'https://example.com'])('普通启动 %s 允许检查', (url) => {
    expect(shouldEnableAutoUpdateCheck(url)).toBe(true);
  });
});
