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
import { uploadLocalClipboard } from '../services/sync/ClipboardSyncActions';
import { getClipboardChangedHandler } from '../services/sync/ClipboardChangedHandler';
import * as startupClock from '../utils/startupClock';

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
