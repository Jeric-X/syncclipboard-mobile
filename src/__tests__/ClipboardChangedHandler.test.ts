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
import { localClipboard } from '../services/clipboard/LocalClipboard';
import { clipboardSyncState } from '../services/sync/SyncState';
import {
  downloadRemoteClipboard,
  uploadLocalClipboard,
} from '../services/sync/ClipboardSyncActions';
import { ClipboardChangedHandler } from '../services/sync/ClipboardChangedHandler';
import { ClipboardStartupBaseline } from '../utils/clipboardStartupBaseline';
import { AppState, ToastAndroid } from 'react-native';
import { updateForegroundNotification } from '../services/notification/ForegroundNotification';

const content: ClipboardContent = {
  type: 'Text',
  text: 'changed text',
  profileHash: 'changed-hash',
  hasData: false,
};

describe('ClipboardChangedHandler 启动基线窗口', () => {
  let handler: ClipboardChangedHandler;
  let startupBaseline: ClipboardStartupBaseline;

  beforeEach(() => {
    jest.clearAllMocks();
    startupBaseline = new ClipboardStartupBaseline();
    handler = new ClipboardChangedHandler(startupBaseline);
    AppState.currentState = 'active';
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
    jest.spyOn(performance, 'now').mockReturnValue(1_999);

    await handler.handleAutoUpload(content);

    expect(uploadLocalClipboard).not.toHaveBeenCalled();
  });

  it('两秒后首次本地内容正常上传', async () => {
    jest.spyOn(performance, 'now').mockReturnValue(2_000);

    await handler.handleAutoUpload(content);

    expect(uploadLocalClipboard).toHaveBeenCalledWith(content);
  });

  it('两秒内首次远程内容仅建立基线', async () => {
    jest.spyOn(performance, 'now').mockReturnValue(1_999);

    await handler.processRemoteClipboardContent({ ...content });

    expect(localClipboard.setClipboardContent).not.toHaveBeenCalled();
  });

  it('两秒后首次远程内容正常复制到本地', async () => {
    jest.spyOn(performance, 'now').mockReturnValue(2_000);
    const copyToLocalClipboard = jest
      .spyOn(
        handler as unknown as {
          copyToLocalClipboard(value: ClipboardContent): Promise<void>;
        },
        'copyToLocalClipboard'
      )
      .mockResolvedValue();

    await handler.processRemoteClipboardContent({ ...content });

    expect(copyToLocalClipboard).toHaveBeenCalledWith(content);
    expect(clipboardSyncState.setRemoteContent).toHaveBeenCalledWith(content);
  });

  it('后台冷启动超过两秒时，本地和远端首次内容仅作为基线，后续变化正常同步', async () => {
    startupBaseline.initialize(true);
    AppState.currentState = 'background';
    jest.spyOn(performance, 'now').mockReturnValue(30_000);

    await handler.handleAutoUpload({ ...content, profileHash: 'local-old' });
    await handler.processRemoteClipboardContent({ ...content, profileHash: 'remote-old' });

    expect(uploadLocalClipboard).not.toHaveBeenCalled();
    expect(localClipboard.setClipboardContent).not.toHaveBeenCalled();
    expect(ToastAndroid.show).not.toHaveBeenCalled();
    expect(updateForegroundNotification).not.toHaveBeenCalled();
    expect(clipboardSyncState.setRemoteContent).toHaveBeenCalled();

    await handler.handleAutoUpload({ ...content, profileHash: 'local-new' });
    await handler.processRemoteClipboardContent({ ...content, profileHash: 'remote-new' });

    expect(uploadLocalClipboard).toHaveBeenCalledTimes(1);
    expect(localClipboard.setClipboardContent).toHaveBeenCalledTimes(1);
    expect(ToastAndroid.show).toHaveBeenCalledTimes(2);
  });

  it('后台首次远端文件不自动下载或触发历史处理，后续文件变化正常下载', async () => {
    startupBaseline.initialize(true);
    jest.spyOn(performance, 'now').mockReturnValue(30_000);
    const file: ClipboardContent = {
      ...content,
      type: 'File',
      hasData: true,
      fileName: 'example.txt',
      fileSize: 12,
    };
    (downloadRemoteClipboard as jest.Mock).mockResolvedValue(file);

    await handler.processRemoteClipboardContent(file);
    expect(downloadRemoteClipboard).not.toHaveBeenCalled();
    expect(historyService.addRemoteContent).not.toHaveBeenCalled();

    await handler.processRemoteClipboardContent({ ...file, profileHash: 'new-file' });
    expect(downloadRemoteClipboard).toHaveBeenCalledTimes(1);
  });

  it('进程反复重建时不会重复同步首次快照或发送提示', async () => {
    jest.spyOn(performance, 'now').mockReturnValue(30_000);
    AppState.currentState = 'background';
    for (let restart = 0; restart < 3; restart++) {
      const restoredHandler = new ClipboardChangedHandler();
      restoredHandler.initializeStartupBaseline(true);
      await restoredHandler.processRemoteClipboardContent({ ...content, profileHash: 'remote' });
      await restoredHandler.handleAutoUpload({ ...content, profileHash: 'local' });
      await restoredHandler.processRemoteClipboardContent({ ...content, profileHash: 'remote' });
      await restoredHandler.handleAutoUpload({ ...content, profileHash: 'local' });
    }
    expect(uploadLocalClipboard).not.toHaveBeenCalled();
    expect(localClipboard.setClipboardContent).not.toHaveBeenCalled();
    expect(ToastAndroid.show).not.toHaveBeenCalled();
    expect(updateForegroundNotification).not.toHaveBeenCalled();
  });
});
