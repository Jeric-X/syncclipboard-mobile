import {
  validateServerConnectionTestFields,
  validateServerCredentials,
} from '@/utils/serverCredentialsValidation';

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

describe('validateServerConnectionTestFields', () => {
  const validFields = {
    type: 'webdav' as const,
    url: 'https://dav.example.com',
    username: '',
    password: '',
    bucketName: '',
  };

  it('匿名 WebDAV 缺少 URL 时应提示 URL 必填', () => {
    expect(validateServerConnectionTestFields({ ...validFields, url: '' })).toBe('urlRequired');
  });

  it('匿名 WebDAV URL 完整时应通过', () => {
    expect(validateServerConnectionTestFields(validFields)).toBeNull();
  });

  it('应保留 SyncClipboard 和 S3 的原有必填提示', () => {
    expect(
      validateServerConnectionTestFields({
        ...validFields,
        type: 'syncclipboard',
        username: '',
        password: '',
      })
    ).toBe('fieldsRequired');
    expect(
      validateServerConnectionTestFields({
        ...validFields,
        type: 's3',
      })
    ).toBe('s3FieldsRequired');
  });
});
