import type { ISyncClipboardAPI } from '@/api/clients/APIClient';
import { DEFAULT_APP_CONFIG, type AppConfig } from '@/types/storage';
import { SmsCodeUploader, type SmsCodeUploaderDependencies } from '@/services/sms/SmsCodeUploader';

function createConfig(): AppConfig {
  return {
    ...DEFAULT_APP_CONFIG,
    enableSmsForwarding: true,
    servers: [
      {
        id: 'primary',
        name: 'Primary',
        type: 'syncclipboard',
        url: 'https://example.com/api',
      },
    ],
    activeServerIndex: 0,
  };
}

function createHarness(overrides: Partial<SmsCodeUploaderDependencies> = {}) {
  let now = 1_000;
  const putClipboard = jest.fn(async () => undefined);
  const logs: Array<{ level: string; message: string; error?: unknown }> = [];
  const deps: SmsCodeUploaderDependencies = {
    now: jest.fn(() => now++),
    sleep: jest.fn(async () => undefined),
    log: jest.fn((level, message, error) => logs.push({ level, message, error })),
    extractVerificationCode: jest.fn(() => '123456'),
    copyToClipboard: jest.fn(async () => undefined),
    loadConfig: jest.fn(async () => createConfig()),
    selectServerForCurrentNetworkOnce: jest.fn(async () => undefined),
    getAPIClient: jest.fn(async () => ({ putClipboard }) as unknown as ISyncClipboardAPI),
    calculateHash: jest.fn(() => 'HASH'),
    updateNotification: jest.fn(),
    notifyUploadSucceeded: jest.fn(),
    ...overrides,
  };
  return { deps, logs, putClipboard, uploader: new SmsCodeUploader(deps) };
}

describe('SmsCodeUploader', () => {
  it('缺少短信正文时跳过上传并记录原因', async () => {
    const h = createHarness();

    const result = await h.uploader.upload(undefined);

    expect(result).toEqual({ status: 'skipped', reason: 'missing-body' });
    expect(h.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining('reason=missing-body') }),
      ])
    );
  });

  it('记录冷启动选服和上传的完整阶段', async () => {
    const h = createHarness();

    const result = await h.uploader.upload({
      from: '+8613800000000',
      body: '您的验证码是 123456',
    });

    expect(result).toEqual({ status: 'uploaded', attempts: 1 });
    expect(h.deps.selectServerForCurrentNetworkOnce).toHaveBeenCalledTimes(1);
    expect(h.putClipboard).toHaveBeenCalledWith({
      type: 'Text',
      text: '123456',
      hash: 'HASH',
      hasData: false,
    });
    const messages = h.logs.map((entry) => entry.message).join('\n');
    expect(messages).toContain('stage=network-preflight');
    expect(messages).toContain('one-shot network server selection completed');
    expect(messages).toContain('stage=client-create');
    expect(messages).toContain('upload attempt=1/4 succeeded');
    expect(messages).not.toContain('+8613800000000');
    expect(messages).not.toContain('123456');
  });

  it('自动选服失败时按上传重试计划重新选服', async () => {
    const error = new Error('native network unavailable');
    const selectServerForCurrentNetworkOnce = jest
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined);
    const h = createHarness({
      selectServerForCurrentNetworkOnce,
    });

    const result = await h.uploader.upload({ from: '10086', body: '验证码 123456' });

    expect(result).toEqual({ status: 'uploaded', attempts: 2 });
    expect(selectServerForCurrentNetworkOnce).toHaveBeenCalledTimes(2);
    expect(h.deps.getAPIClient).toHaveBeenCalledTimes(1);
    expect(h.putClipboard).toHaveBeenCalledTimes(1);
    expect(h.deps.sleep).toHaveBeenCalledWith(3_000);
    expect(h.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          message: expect.stringContaining('stage=network-preflight'),
          error,
        }),
      ])
    );
  });

  it('自动选服持续失败时耗尽重试且不创建客户端', async () => {
    const error = new Error('network unavailable');
    const h = createHarness({
      selectServerForCurrentNetworkOnce: jest.fn(async () => {
        throw error;
      }),
    });

    const result = await h.uploader.upload({ from: '10086', body: '验证码 123456' });

    expect(result).toEqual({
      status: 'failed',
      stage: 'network-preflight',
      error: 'Error: network unavailable',
    });
    expect(h.deps.selectServerForCurrentNetworkOnce).toHaveBeenCalledTimes(4);
    expect(h.deps.getAPIClient).not.toHaveBeenCalled();
    expect(h.putClipboard).not.toHaveBeenCalled();
    expect(h.deps.sleep).toHaveBeenCalledTimes(3);
    expect(h.deps.sleep).toHaveBeenNthCalledWith(1, 3_000);
    expect(h.deps.sleep).toHaveBeenNthCalledWith(2, 10_000);
    expect(h.deps.sleep).toHaveBeenNthCalledWith(3, 30_000);
  });

  it('记录每次上传失败和重试等待', async () => {
    const putClipboard = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
      .mockResolvedValueOnce(undefined);
    const h = createHarness({
      getAPIClient: jest.fn(async () => ({ putClipboard }) as unknown as ISyncClipboardAPI),
    });

    const result = await h.uploader.upload({ from: '10086', body: '验证码 123456' });

    expect(result).toEqual({ status: 'uploaded', attempts: 2 });
    expect(h.deps.selectServerForCurrentNetworkOnce).toHaveBeenCalledTimes(2);
    expect(h.deps.getAPIClient).toHaveBeenCalledTimes(2);
    expect(h.deps.sleep).toHaveBeenCalledWith(3_000);
    const messages = h.logs.map((entry) => entry.message).join('\n');
    expect(messages).toContain('attempt=1/4 failed');
    expect(messages).toContain('code=ETIMEDOUT');
    expect(messages).toContain('retry scheduled delayMs=3000');
    expect(messages).toContain('upload attempt=2/4 succeeded');
  });

  it('上传成功后的通知失败不会导致重复上传', async () => {
    const h = createHarness({
      notifyUploadSucceeded: jest.fn(() => {
        throw new Error('notification unavailable');
      }),
    });

    const result = await h.uploader.upload({ from: '10086', body: '验证码 123456' });

    expect(result).toEqual({ status: 'uploaded', attempts: 1 });
    expect(h.putClipboard).toHaveBeenCalledTimes(1);
    expect(h.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          message: expect.stringContaining('success notification failed'),
        }),
      ])
    );
  });
});
