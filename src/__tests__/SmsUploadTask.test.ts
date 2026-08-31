jest.mock('../utils/Logger', () => ({
  initLogger: jest.fn(),
}));

jest.mock('../services/sms/SmsCodeUploader', () => ({
  SmsCodeUploader: jest.fn().mockImplementation(() => ({
    upload: jest.fn(async () => ({ status: 'uploaded', attempts: 1 })),
  })),
}));

jest.mock('../services/ClientFactory', () => ({
  getAPIClient: jest.fn(),
}));

jest.mock('../services/NetworkAutoSwitchService', () => ({
  networkAutoSwitchService: { ensureCurrentServer: jest.fn() },
}));

jest.mock(
  'sms-forwarder',
  () => ({
    extractVerificationCode: jest.fn(),
    startSmsUploadCountdown: jest.fn(),
    updateSmsUploadNotification: jest.fn(),
  }),
  { virtual: true }
);

import { Platform } from 'react-native';
import { SmsCodeUploader } from '../services/sms/SmsCodeUploader';
import SmsUploadTask from '../tasks/SmsUploadTask';
import { initLogger } from '../utils/Logger';

const mockInitLogger = initLogger as jest.Mock;
const mockUploader = (SmsCodeUploader as jest.Mock).mock.results[0].value as {
  upload: jest.Mock;
};
const mockUpload = mockUploader.upload;

describe('SmsUploadTask', () => {
  const originalPlatform = Platform.OS;

  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpload.mockResolvedValue({ status: 'uploaded', attempts: 1 });
  });

  it('先初始化日志，再调用验证码上传服务', async () => {
    const taskData = { from: '10086', body: '验证码 123456' };

    await SmsUploadTask(taskData);

    expect(mockInitLogger).toHaveBeenCalledTimes(1);
    expect(mockUpload).toHaveBeenCalledWith(taskData);
    expect(mockInitLogger.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpload.mock.invocationCallOrder[0]
    );
  });

  it('日志初始化失败时仍继续上传', async () => {
    const error = new Error('logger unavailable');
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockInitLogger.mockImplementationOnce(() => {
      throw error;
    });

    await SmsUploadTask({ from: '10086', body: '验证码 123456' });

    expect(consoleError).toHaveBeenCalledWith(
      '[SmsUploadTask] stage=logging logger initialization failed',
      error
    );
    expect(mockUpload).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
