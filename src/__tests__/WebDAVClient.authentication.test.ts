import { WebDAVClient } from '@/api/clients/WebDAVClient';
import type { Credentials } from '@/api/AuthService';

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
}));

class InspectableWebDAVClient extends WebDAVClient {
  public inspectHeaders(): Promise<Record<string, string>> {
    return this.getHeaders();
  }

  public inspectCredentials(): Credentials | null | undefined {
    return this.authService?.getCredentials();
  }
}

describe('WebDAVClient authentication', () => {
  it('匿名配置不应发送 Authorization 请求头', async () => {
    const client = new InspectableWebDAVClient({ baseURL: 'https://dav.example.com' });
    const whitespaceClient = new InspectableWebDAVClient({
      baseURL: 'https://dav.example.com',
      username: '  ',
      password: '\n',
    });

    await expect(client.inspectHeaders()).resolves.toEqual(
      expect.not.objectContaining({ Authorization: expect.any(String) })
    );
    await expect(whitespaceClient.inspectHeaders()).resolves.toEqual(
      expect.not.objectContaining({ Authorization: expect.any(String) })
    );
  });

  it('完整凭据应继续发送 Basic Authorization 请求头', async () => {
    const client = new InspectableWebDAVClient({
      baseURL: 'https://dav.example.com',
      username: 'user',
      password: 'password',
    });

    await expect(client.inspectHeaders()).resolves.toMatchObject({
      Authorization: 'Basic dXNlcjpwYXNzd29yZA==',
    });
  });

  it('生成认证头时应保留凭据中的首尾空格', () => {
    const client = new InspectableWebDAVClient({
      baseURL: 'https://dav.example.com',
      username: ' user ',
      password: ' password ',
    });
    const usernameOnlyClient = new InspectableWebDAVClient({
      baseURL: 'https://dav.example.com',
      username: ' user ',
    });

    expect(client.inspectCredentials()).toEqual({
      username: ' user ',
      password: ' password ',
    });
    expect(usernameOnlyClient.inspectCredentials()).toEqual({
      username: ' user ',
      password: '',
    });
  });

  it('只有用户名时应发送空密码的 Basic Authorization 请求头', async () => {
    const client = new InspectableWebDAVClient({
      baseURL: 'https://dav.example.com',
      username: 'user',
    });

    await expect(client.inspectHeaders()).resolves.toMatchObject({
      Authorization: 'Basic dXNlcjo=',
    });
  });

  it('只有密码时应发送空用户名的 Basic Authorization 请求头', async () => {
    const client = new InspectableWebDAVClient({
      baseURL: 'https://dav.example.com',
      password: 'password',
    });

    await expect(client.inspectHeaders()).resolves.toMatchObject({
      Authorization: 'Basic OnBhc3N3b3Jk',
    });
  });
});
