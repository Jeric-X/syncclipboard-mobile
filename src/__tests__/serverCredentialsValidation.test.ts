import { validateServerCredentials } from '@/utils/serverCredentialsValidation';

describe('validateServerCredentials', () => {
  describe('WebDAV 匿名访问', () => {
    it('应允许用户名和密码同时为空', () => {
      expect(validateServerCredentials('webdav', '', '')).toBeNull();
      expect(validateServerCredentials('webdav', '  ', '\n')).toBeNull();
    });

    it('应继续接受完整的用户名和密码', () => {
      expect(validateServerCredentials('webdav', 'user', 'password')).toBeNull();
    });

    it('应允许只填写一项凭据', () => {
      expect(validateServerCredentials('webdav', '', 'password')).toBeNull();
      expect(validateServerCredentials('webdav', 'user', '')).toBeNull();
    });
  });

  describe('SyncClipboard 回归行为', () => {
    it('应继续要求用户名和密码', () => {
      expect(validateServerCredentials('syncclipboard', '', '')).toBe('usernameRequired');
      expect(validateServerCredentials('syncclipboard', 'user', '')).toBe('passwordRequired');
      expect(validateServerCredentials('syncclipboard', 'user', 'password')).toBeNull();
    });
  });
});
