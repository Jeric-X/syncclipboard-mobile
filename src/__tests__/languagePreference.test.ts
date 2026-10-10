import { resolveLanguagePreference } from '../utils/languagePreference';

it.each([
  ['zh', 'en', 'zh'],
  ['zh-CN', 'en', 'zh'],
  ['zh_TW', 'en', 'zh'],
  ['en', 'zh', 'en'],
  ['en-US', 'zh', 'en'],
  ['auto', 'zh-CN', 'zh'],
  ['auto', 'en', 'en'],
  [null, 'zh', 'zh'],
  [null, null, 'zh'],
])('语言偏好 %s、系统 %s 解析为 %s', (saved, system, expected) => {
  expect(resolveLanguagePreference(saved, system)).toBe(expected);
});
