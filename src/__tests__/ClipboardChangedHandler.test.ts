import type { ClipboardContent } from '@/types/clipboard';
import { AppState } from 'react-native';
import { DEFAULT_APP_CONFIG } from '../types/storage';

jest.mock('react-native', () => ({
  AppState: { currentState: 'active' },
  Platform: { OS: 'android' },
  ToastAndroid: { SHORT: 0, show: jest.fn() },
}));

jest.mock('../services/ConfigService', () => ({
  configService: {
    getConfig: jest.fn(),
    getActiveServer: jest.fn(),
  },
}));

jest.mock('../services/sync/ClipboardSyncActions', () => ({
  uploadLocalClipboard: jest.fn(),
  downloadRemoteClipboard: jest.fn(),
}));

jest.mock('../services/sync/JustSetHash', () => ({
  getJustUploadedHash: jest.fn(() => null),
  clearJustUploadedHash: jest.fn(),
  getJustSetLocalHash: jest.fn(() => null),
  clearJustSetLocalHash: jest.fn(),
}));

jest.mock('../services/notification/ForegroundNotification', () => ({
  updateForegroundNotification: jest.fn(),
}));

jest.mock('../services/history/HistoryService', () => ({
  historyService: {
    addRemoteContent: jest.fn(),
  },
}));

jest.mock('../services/sync/SyncState', () => ({
  clipboardSyncState: {
    getState: jest.fn(() => ({ remoteContent: null })),
    setRemoteContent: jest.fn(),
  },
}));

jest.mock('../services/sync/RemoteClipboardMonitor', () => ({
  remoteClipboardMonitor: {
    refresh: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../services/clipboard/LocalClipboard', () => ({
  localClipboard: {
    setClipboardContent: jest.fn(),
  },
}));

jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));

import { configService } from '../services/ConfigService';
import { historyService } from '../services/history/HistoryService';
import { clipboardSyncState } from '../services/sync/SyncState';
import {
  uploadLocalClipboard,
  downloadRemoteClipboard,
} from '../services/sync/ClipboardSyncActions';
import { localClipboard } from '../services/clipboard/LocalClipboard';
import { getClipboardChangedHandler } from '../services/sync/ClipboardChangedHandler';
import * as startupClock from '../services/StartupTiming';

const SYSTEM_START_TIME_MS = 2_728_733_964;

const content: ClipboardContent = {
  type: 'Text',
  text: 'changed text',
  profileHash: 'changed-hash',
  hasData: false,
};

describe('ClipboardChangedHandler 启动基线窗口', () => {
  const handler = getClipboardChangedHandler();
  let copyToLocalClipboard: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(performance, 'now').mockReturnValue(SYSTEM_START_TIME_MS);
    jest
      .spyOn(startupClock, 'getStartupElapsedMs')
      .mockImplementation(startupClock.createStartupClock(() => performance.now()));
    handler.resetHashes();
    copyToLocalClipboard = jest
      .spyOn(
        handler as unknown as {
          copyToLocalClipboard(value: ClipboardContent): Promise<void>;
        },
        'copyToLocalClipboard'
      )
      .mockResolvedValue();
    (configService.getConfig as jest.Mock).mockResolvedValue({
      autoSync: true,
      enableBackgroundTasks: false,
      enableBackgroundUpload: false,
    });
    (configService.getActiveServer as jest.Mock).mockResolvedValue({
      id: 'server',
      type: 'syncclipboard',
      url: 'https://example.com',
    });
    (historyService.addRemoteContent as jest.Mock).mockResolvedValue({});
    (uploadLocalClipboard as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('两秒内首次本地内容仅建立基线', async () => {
    jest.spyOn(performance, 'now').mockReturnValue(SYSTEM_START_TIME_MS + 1_999);

    await handler.handleAutoUpload(content);

    expect(uploadLocalClipboard).not.toHaveBeenCalled();
  });

  it('两秒后首次本地内容正常上传', async () => {
    jest.spyOn(performance, 'now').mockReturnValue(SYSTEM_START_TIME_MS + 2_000);

    await handler.handleAutoUpload(content);

    expect(uploadLocalClipboard).toHaveBeenCalledWith(content);
  });

  it('两秒内首次远程内容仅建立基线', async () => {
    jest.spyOn(performance, 'now').mockReturnValue(SYSTEM_START_TIME_MS + 1_999);

    await handler.processRemoteClipboardContent({ ...content });

    expect(copyToLocalClipboard).not.toHaveBeenCalled();
  });

  it('两秒后首次远程内容正常复制到本地', async () => {
    jest.spyOn(performance, 'now').mockReturnValue(SYSTEM_START_TIME_MS + 2_000);

    await handler.processRemoteClipboardContent({ ...content });

    expect(copyToLocalClipboard).toHaveBeenCalledWith(content);
    expect(clipboardSyncState.setRemoteContent).toHaveBeenCalledWith(content);
  });

  it('两秒内建立本地基线后，新变化仍正常上传', async () => {
    jest.spyOn(performance, 'now').mockReturnValue(SYSTEM_START_TIME_MS + 500);
    await handler.handleAutoUpload(content);
    const next = { ...content, text: 'new text', profileHash: 'new-hash' };
    jest.spyOn(performance, 'now').mockReturnValue(SYSTEM_START_TIME_MS + 1_000);

    await handler.handleAutoUpload(next);

    expect(uploadLocalClipboard).toHaveBeenCalledTimes(1);
    expect(uploadLocalClipboard).toHaveBeenCalledWith(next);
  });

  it('两秒内建立远端基线后，新变化仍正常复制', async () => {
    jest.spyOn(performance, 'now').mockReturnValue(SYSTEM_START_TIME_MS + 500);
    await handler.processRemoteClipboardContent({ ...content });
    const next = { ...content, text: 'new text', profileHash: 'new-hash' };
    jest.spyOn(performance, 'now').mockReturnValue(SYSTEM_START_TIME_MS + 1_000);

    await handler.processRemoteClipboardContent(next);

    expect(copyToLocalClipboard).toHaveBeenCalledTimes(1);
    expect(copyToLocalClipboard).toHaveBeenCalledWith(next);
  });
});

describe('远程图片自动复制', () => {
  const handler = getClipboardChangedHandler();
  const image: ClipboardContent = {
    type: 'Image',
    text: '',
    profileHash: 'image-hash',
    hasData: true,
    fileName: 'image.png',
    fileSize: 1024,
  };
  const downloadedImage = { ...image, fileUri: 'file:///image.png' };

  beforeEach(() => {
    jest.clearAllMocks();
    handler.resetHashes();
    AppState.currentState = 'active';
    jest.spyOn(startupClock, 'getStartupElapsedMs').mockReturnValue(3_000);
    (configService.getConfig as jest.Mock).mockResolvedValue({
      ...DEFAULT_APP_CONFIG,
      autoSync: true,
    });
    (configService.getActiveServer as jest.Mock).mockResolvedValue({ id: 'server' });
    (historyService.addRemoteContent as jest.Mock).mockResolvedValue({});
    (downloadRemoteClipboard as jest.Mock).mockResolvedValue(downloadedImage);
  });

  afterEach(() => {
    AppState.currentState = 'active';
    jest.restoreAllMocks();
  });

  it('默认下载并自动复制图片，重复通知不会再次复制', async () => {
    await handler.processRemoteClipboardContent({ ...image });
    await handler.processRemoteClipboardContent({ ...image });

    expect(downloadRemoteClipboard).toHaveBeenCalledTimes(1);
    expect(localClipboard.setClipboardContent).toHaveBeenCalledTimes(1);
    expect(localClipboard.setClipboardContent).toHaveBeenCalledWith(downloadedImage, true);
  });

  it('开启仅自动复制文字后仍下载图片，但不复制图片，文字仍正常复制', async () => {
    (configService.getConfig as jest.Mock).mockResolvedValue({
      ...DEFAULT_APP_CONFIG,
      autoSync: true,
      autoCopyTextOnly: true,
    });

    await handler.processRemoteClipboardContent({ ...image });

    expect(downloadRemoteClipboard).toHaveBeenCalledWith(image);
    expect(clipboardSyncState.setRemoteContent).toHaveBeenCalledWith(downloadedImage);
    expect(localClipboard.setClipboardContent).not.toHaveBeenCalled();

    await handler.processRemoteClipboardContent({ ...content });
    expect(localClipboard.setClipboardContent).toHaveBeenCalledWith(content, true);
  });

  it.each([false, true])('后台下载遵守仅自动复制文字开关：%s', async (textOnly) => {
    AppState.currentState = 'background';
    (configService.getConfig as jest.Mock).mockResolvedValue({
      ...DEFAULT_APP_CONFIG,
      autoSync: false,
      enableBackgroundTasks: true,
      enableBackgroundDownload: true,
      autoCopyTextOnly: textOnly,
    });

    await handler.processRemoteClipboardContent({ ...image });

    expect(localClipboard.setClipboardContent).toHaveBeenCalledTimes(textOnly ? 0 : 1);
  });

  it('自动同步和后台下载均关闭时不自动复制图片', async () => {
    (configService.getConfig as jest.Mock).mockResolvedValue({
      ...DEFAULT_APP_CONFIG,
      autoSync: false,
      enableBackgroundDownload: false,
    });

    await handler.processRemoteClipboardContent({ ...image });

    expect(localClipboard.setClipboardContent).not.toHaveBeenCalled();
  });

  it('复用历史中已下载的图片并复制', async () => {
    (historyService.addRemoteContent as jest.Mock).mockResolvedValue({
      fileUri: downloadedImage.fileUri,
    });

    await handler.processRemoteClipboardContent({ ...image });

    expect(downloadRemoteClipboard).not.toHaveBeenCalled();
    expect(localClipboard.setClipboardContent).toHaveBeenCalledWith(downloadedImage, true);
  });

  it('超过大小限制的图片不下载也不复制', async () => {
    await handler.processRemoteClipboardContent({ ...image, fileSize: 6 * 1024 * 1024 });

    expect(downloadRemoteClipboard).not.toHaveBeenCalled();
    expect(localClipboard.setClipboardContent).not.toHaveBeenCalled();
  });

  it('下载失败时不复制图片', async () => {
    (downloadRemoteClipboard as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('cancelled'), { name: 'AbortError' })
    );

    await handler.processRemoteClipboardContent({ ...image });

    expect(localClipboard.setClipboardContent).not.toHaveBeenCalled();
  });

  it('缺少本地图片文件时不复制，即使包含描述文字', async () => {
    await handler.processRemoteClipboardContent({
      ...image,
      text: 'image description',
      fileSize: undefined,
    });

    expect(localClipboard.setClipboardContent).not.toHaveBeenCalled();
  });

  it('启动基线只下载图片，不覆盖剪贴板', async () => {
    jest.spyOn(startupClock, 'getStartupElapsedMs').mockReturnValue(1_000);

    await handler.processRemoteClipboardContent({ ...image });

    expect(downloadRemoteClipboard).toHaveBeenCalled();
    expect(localClipboard.setClipboardContent).not.toHaveBeenCalled();
  });

  it.each(['File', 'Group'] as const)('不自动复制 %s 类型', async (type) => {
    (historyService.addRemoteContent as jest.Mock).mockResolvedValue({
      fileUri: downloadedImage.fileUri,
    });

    await handler.processRemoteClipboardContent({ ...image, type });

    expect(localClipboard.setClipboardContent).not.toHaveBeenCalled();
  });
});
