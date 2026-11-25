import type { ClipboardContent } from '../types/clipboard';

const mockDownloadData = jest.fn();
const mockSetRemoteClipboard = jest.fn();

jest.mock('../services/history/HistoryService', () => ({
  historyService: {
    addLocalContent: jest.fn(),
    getItem: jest.fn(async () => null),
  },
}));

jest.mock('../services/client/ClientService', () => ({
  getClientService: () => ({
    downloadData: mockDownloadData,
    setRemoteClipboard: mockSetRemoteClipboard,
  }),
}));

jest.mock('../services/ConfigService', () => ({
  configService: {
    getActiveServer: jest.fn(),
  },
}));

jest.mock('../services/NetworkAutoSwitchService', () => ({
  networkAutoSwitchService: {
    ensureCurrentServer: jest.fn(async () => undefined),
  },
}));

jest.mock('../services/sync/RemoteClipboardMonitor', () => ({
  remoteClipboardMonitor: {
    fetchLatest: jest.fn(),
    refresh: jest.fn(),
  },
}));

jest.mock('../services/sync/SyncState', () => ({
  clipboardSyncState: {
    getState: jest.fn(() => ({ remoteContent: null })),
    setState: jest.fn(),
    setDownloadingRemote: jest.fn(),
    setDownloadProgress: jest.fn(),
    clearDownloadState: jest.fn(),
    setUploadingClipboard: jest.fn(),
    setUploadProgress: jest.fn(),
    setRemoteContent: jest.fn(),
  },
}));

jest.mock('../services/clipboard/ClipboardMonitor', () => ({
  clipboardMonitor: {
    getLastContent: jest.fn(),
    triggerCheck: jest.fn(),
  },
}));

jest.mock('../services/clipboard/LocalClipboard', () => ({
  localClipboard: {
    setClipboardContent: jest.fn(),
  },
}));

import { File } from 'expo-file-system';
import { clipboardSyncState } from '../services/sync/SyncState';
import { historyService } from '../services/history/HistoryService';
import { downloadRemoteClipboard, setRemoteClipboard } from '../services/sync/ClipboardSyncActions';
import { configService } from '../services/ConfigService';
import { networkAutoSwitchService } from '../services/NetworkAutoSwitchService';
import { remoteClipboardMonitor } from '../services/sync/RemoteClipboardMonitor';

describe('setRemoteClipboard', () => {
  const localContent: ClipboardContent = {
    type: 'Text',
    text: 'local text',
    hasData: false,
    profileHash: 'local',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (configService.getActiveServer as jest.Mock).mockResolvedValue({
      id: 'home',
      type: 'syncclipboard',
      url: 'https://home.example',
    });
  });

  it('上传底层不执行网络自动切换预检', async () => {
    await setRemoteClipboard(localContent, new AbortController().signal);

    expect(networkAutoSwitchService.ensureCurrentServer).not.toHaveBeenCalled();
    expect(mockSetRemoteClipboard).toHaveBeenCalledWith(
      localContent,
      expect.any(Function),
      expect.any(AbortSignal)
    );
  });
});

describe('downloadRemoteClipboard', () => {
  const remoteContent: ClipboardContent = {
    type: 'Image',
    text: 'remote.png',
    hasData: true,
    fileName: 'remote.png',
    fileSize: 10,
    profileHash: 'remote',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDownloadData.mockResolvedValue({ ...remoteContent, fileUri: 'file:///remote.png' });
  });

  it('shows cached downloads on the current card without a network transfer', async () => {
    const fileUri = 'file:///cached.png';
    jest.mocked(File).mockImplementationOnce(() => ({ exists: true }) as File);
    jest.mocked(historyService.getItem).mockResolvedValueOnce({
      fileUri,
    } as NonNullable<Awaited<ReturnType<typeof historyService.getItem>>>);
    jest.mocked(clipboardSyncState.getState).mockReturnValue({
      ...clipboardSyncState.getState(),
      remoteContent,
    });
    await downloadRemoteClipboard(remoteContent);
    expect(clipboardSyncState.setRemoteContent).toHaveBeenCalledWith({ ...remoteContent, fileUri });
    expect(mockDownloadData).not.toHaveBeenCalled();
  });

  it('信任已获取的远程内容，下载前不重新拉取', async () => {
    await downloadRemoteClipboard(remoteContent);

    expect(remoteClipboardMonitor.fetchLatest).not.toHaveBeenCalled();
    expect(mockDownloadData).toHaveBeenCalledWith(
      remoteContent,
      expect.any(Function),
      expect.any(AbortSignal)
    );
  });
});
