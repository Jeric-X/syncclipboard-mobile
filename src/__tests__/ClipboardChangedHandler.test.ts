import type { ClipboardContent } from '@/types/clipboard';

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
  isClipboardUploadRunning: jest.fn(() => false),
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
    hasObservedProfileHash: jest.fn(() => true),
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
  isClipboardUploadRunning,
} from '../services/sync/ClipboardSyncActions';
import { getClipboardChangedHandler } from '../services/sync/ClipboardChangedHandler';
import { remoteClipboardMonitor } from '../services/sync/RemoteClipboardMonitor';
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
    jest.mocked(isClipboardUploadRunning).mockReturnValue(false);
    jest.mocked(remoteClipboardMonitor.hasObservedProfileHash).mockReturnValue(true);
    jest.spyOn(performance, 'now').mockReturnValue(SYSTEM_START_TIME_MS);
    jest
      .spyOn(startupClock, 'getStartupElapsedMs')
      .mockImplementation(startupClock.createStartupClock(() => performance.now()));
    handler.resetHashes();
    jest
      .mocked(clipboardSyncState.getState)
      .mockReturnValue({ remoteContent: null } as ReturnType<typeof clipboardSyncState.getState>);
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

describe('复制当前远程图片', () => {
  const handler = getClipboardChangedHandler();
  const image: ClipboardContent = {
    type: 'Image',
    text: 'photo.png',
    fileName: 'photo.png',
    profileHash: 'remote-image',
    localClipboardHash: 'image-bytes',
    hasData: true,
    fileUri: 'file:///photo.png',
  };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(isClipboardUploadRunning).mockReturnValue(false);
    jest.mocked(remoteClipboardMonitor.hasObservedProfileHash).mockReturnValue(true);
    handler.resetHashes();
    handler.setLastRemoteProfileHash(image.profileHash!);
    jest.spyOn(startupClock, 'getStartupElapsedMs').mockReturnValue(5000);
    jest
      .mocked(configService.getConfig)
      .mockResolvedValue({ autoSync: true } as Awaited<ReturnType<typeof configService.getConfig>>);
    jest
      .mocked(configService.getActiveServer)
      .mockResolvedValue({ type: 'syncclipboard' } as Awaited<
        ReturnType<typeof configService.getActiveServer>
      >);
    jest
      .mocked(clipboardSyncState.getState)
      .mockReturnValue({ remoteContent: image } as ReturnType<typeof clipboardSyncState.getState>);
  });
  afterEach(() => jest.restoreAllMocks());

  it('历史页复制当前远程图片不回传', async () => {
    await handler.handleAutoUpload({ ...image });
    expect(uploadLocalClipboard).not.toHaveBeenCalled();
  });
  it('直接上传进行中即使 UI 标志为 false 仍进入上传替换流程', async () => {
    jest.mocked(isClipboardUploadRunning).mockReturnValue(true);
    jest
      .mocked(clipboardSyncState.getState)
      .mockReturnValue({ remoteContent: image, uploadingClipboard: false } as ReturnType<
        typeof clipboardSyncState.getState
      >);
    await handler.handleAutoUpload({ ...image });
    expect(uploadLocalClipboard).toHaveBeenCalledWith(image);
  });
  it('切换服务器后不使用旧远程缓存跳过上传', async () => {
    handler.resetLastRemoteProfileHash();
    await handler.handleAutoUpload({ ...image });
    expect(uploadLocalClipboard).toHaveBeenCalledWith(image);
  });
  it('后台远程监听断开后不根据旧缓存跳过上传', async () => {
    jest.mocked(remoteClipboardMonitor.hasObservedProfileHash).mockReturnValue(false);
    await handler.handleAutoUpload({ ...image });
    expect(uploadLocalClipboard).toHaveBeenCalledWith(image);
  });
  it('复制其他历史图片仍正常上传', async () => {
    const other = { ...image, profileHash: 'other-image', localClipboardHash: 'other-bytes' };
    await handler.handleAutoUpload(other);
    expect(uploadLocalClipboard).toHaveBeenCalledWith(other);
  });
});
