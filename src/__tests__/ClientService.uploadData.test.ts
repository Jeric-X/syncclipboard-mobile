import { Platform } from 'react-native';
import { createClientFromConfig } from '@/services/ClientFactory';
import { historyService } from '@/services/history/HistoryService';
import { HistorySyncStatus } from '@/types/clipboard';
import type { ClipboardContent } from '@/types/clipboard';

jest.mock('@/services/history/HistoryService', () => ({
  historyService: { getItem: jest.fn(), updateItem: jest.fn() },
}));

jest.mock('@/services/ConfigService', () => ({
  configService: {
    getActiveServer: jest.fn(),
    getConfig: jest.fn(),
  },
}));

jest.mock('@/services/ClientFactory', () => ({
  getAPIClient: jest.fn(),
  createClientFromConfig: jest.fn(),
}));

jest.mock('@/services/client/StorageClient', () => ({
  downloadForStorage: jest.fn(),
  uploadForStorage: jest.fn(),
}));

jest.mock('@/services/client/SyncClipboardClient', () => ({
  downloadForSyncClipboard: jest.fn(),
  uploadForSyncClipboard: jest.fn(),
}));

import { getClientService } from '@/services/client/ClientService';
import { configService } from '@/services/ConfigService';
import { HistoryAPINotInitializedError } from '@/errors';
import { downloadForStorage } from '@/services/client/StorageClient';
import { uploadForStorage } from '@/services/client/StorageClient';
import { downloadForSyncClipboard } from '@/services/client/SyncClipboardClient';
import { uploadForSyncClipboard } from '@/services/client/SyncClipboardClient';

describe('ClientService.uploadData', () => {
  const mockConfigService = configService as jest.Mocked<typeof configService>;
  const mockDownloadForStorage = downloadForStorage as jest.MockedFunction<
    typeof downloadForStorage
  >;
  const mockUploadForStorage = uploadForStorage as jest.MockedFunction<typeof uploadForStorage>;
  const mockDownloadForSyncClipboard = downloadForSyncClipboard as jest.MockedFunction<
    typeof downloadForSyncClipboard
  >;
  const mockUploadForSyncClipboard = uploadForSyncClipboard as jest.MockedFunction<
    typeof uploadForSyncClipboard
  >;

  const content: ClipboardContent = {
    type: 'Image',
    text: 'demo.png',
    hasData: true,
    fileUri: 'file:///tmp/demo.png',
    fileName: 'demo.png',
    fileSize: 123,
    profileHash: 'abc123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDownloadForStorage.mockResolvedValue(content);
    mockUploadForStorage.mockResolvedValue(undefined);
    mockDownloadForSyncClipboard.mockResolvedValue(content);
    mockUploadForSyncClipboard.mockResolvedValue(content);
  });

  it('regression: old logic would throw HistoryAPINotInitializedError when history sync is disabled', async () => {
    const historyApiError = new HistoryAPINotInitializedError();
    mockUploadForSyncClipboard.mockRejectedValue(historyApiError);

    // Simulate pre-fix behavior in ClientService.uploadData:
    // if (server.type === 'syncclipboard') return uploadForSyncClipboard(...)
    const oldUploadData = async () => {
      return await uploadForSyncClipboard(content, undefined, undefined);
    };

    await expect(oldUploadData()).rejects.toThrow(HistoryAPINotInitializedError);
  });

  it('regression: should not throw HistoryAPINotInitializedError after fix when history sync is disabled', async () => {
    const historyApiError = new HistoryAPINotInitializedError();
    mockUploadForSyncClipboard.mockRejectedValue(historyApiError);
    mockUploadForStorage.mockResolvedValue(undefined);

    mockConfigService.getActiveServer.mockResolvedValue({
      type: 'syncclipboard',
      url: 'https://sync.example.com',
    });
    mockConfigService.getConfig.mockResolvedValue({ enableHistorySync: false } as never);

    await expect(getClientService().uploadData(content)).resolves.not.toThrow();
    expect(mockUploadForStorage).toHaveBeenCalledTimes(1);
    expect(mockUploadForSyncClipboard).not.toHaveBeenCalled();
  });

  it('should use uploadForStorage when server is syncclipboard and history sync is disabled', async () => {
    mockConfigService.getActiveServer.mockResolvedValue({
      type: 'syncclipboard',
      url: 'https://sync.example.com',
    });
    mockConfigService.getConfig.mockResolvedValue({ enableHistorySync: false } as never);

    await getClientService().uploadData(content);

    expect(mockUploadForStorage).toHaveBeenCalledTimes(1);
    expect(mockUploadForStorage).toHaveBeenCalledWith(content, undefined, undefined);
    expect(mockUploadForSyncClipboard).not.toHaveBeenCalled();
  });

  it('iOS publishes attachments once and reconciles the confirmed history record', async () => {
    const platform = Platform.OS;
    Platform.OS = 'ios';
    try {
      const putContent = jest.fn();
      jest
        .mocked(createClientFromConfig)
        .mockReturnValue({ putContent } as unknown as ReturnType<typeof createClientFromConfig>);
      const server = { type: 'syncclipboard' as const, url: 'https://sync.example.com' };
      mockConfigService.getConfig.mockResolvedValue({
        enableHistorySync: true,
        servers: [server],
        activeServerIndex: 0,
      } as never);
      mockConfigService.getActiveServer.mockResolvedValue(server);
      await getClientService().setRemoteClipboard(content);
      expect(putContent).toHaveBeenCalledTimes(1);
      const confirmed = {
        hash: content.profileHash,
        version: 2,
        lastModified: '2026-01-01T00:00:00Z',
      };
      jest
        .mocked(historyService.getItem)
        .mockResolvedValueOnce({ starred: true } as never)
        .mockResolvedValueOnce({ starred: false } as never);
      await putContent.mock.calls[0][1].history.confirm(confirmed);
      expect(historyService.updateItem).not.toHaveBeenCalled();
      await putContent.mock.calls[0][1].history.confirm(confirmed);
      expect(historyService.updateItem).toHaveBeenCalledWith(content.profileHash, {
        version: 2,
        lastModified: Date.parse(confirmed.lastModified),
        syncStatus: HistorySyncStatus.Synced,
      });
    } finally {
      Platform.OS = platform;
    }
  });

  it('should use uploadForSyncClipboard when server is syncclipboard and history sync is enabled', async () => {
    mockConfigService.getActiveServer.mockResolvedValue({
      type: 'syncclipboard',
      url: 'https://sync.example.com',
    });
    mockConfigService.getConfig.mockResolvedValue({ enableHistorySync: true } as never);

    await getClientService().uploadData(content);

    expect(mockUploadForSyncClipboard).toHaveBeenCalledTimes(1);
    expect(mockUploadForSyncClipboard).toHaveBeenCalledWith(content, undefined, undefined);
    expect(mockUploadForStorage).not.toHaveBeenCalled();
  });
});

describe('ClientService.downloadData', () => {
  const mockConfigService = configService as jest.Mocked<typeof configService>;
  const mockDownloadForStorage = downloadForStorage as jest.MockedFunction<
    typeof downloadForStorage
  >;
  const mockDownloadForSyncClipboard = downloadForSyncClipboard as jest.MockedFunction<
    typeof downloadForSyncClipboard
  >;

  const remoteContent: ClipboardContent = {
    type: 'Image',
    text: 'remote.png',
    hasData: true,
    fileName: 'remote.png',
    profileHash: 'remote-abc123',
  };

  const downloadedContent: ClipboardContent = {
    ...remoteContent,
    fileUri: 'file:///tmp/remote.png',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockDownloadForStorage.mockResolvedValue(downloadedContent);
    mockDownloadForSyncClipboard.mockResolvedValue(downloadedContent);
  });

  it('regression: old logic would throw HistoryAPINotInitializedError when history sync is disabled', async () => {
    const historyApiError = new HistoryAPINotInitializedError();
    mockDownloadForSyncClipboard.mockRejectedValue(historyApiError);

    // Simulate pre-fix behavior in ClientService.downloadData:
    // if (server.type === 'syncclipboard') return downloadForSyncClipboard(...)
    const oldDownloadData = async () => {
      return await downloadForSyncClipboard(remoteContent, undefined, undefined);
    };

    await expect(oldDownloadData()).rejects.toThrow(HistoryAPINotInitializedError);
  });

  it('regression: should not throw HistoryAPINotInitializedError after fix when history sync is disabled', async () => {
    const historyApiError = new HistoryAPINotInitializedError();
    mockDownloadForSyncClipboard.mockRejectedValue(historyApiError);
    mockDownloadForStorage.mockResolvedValue(downloadedContent);

    mockConfigService.getActiveServer.mockResolvedValue({
      type: 'syncclipboard',
      url: 'https://sync.example.com',
    });
    mockConfigService.getConfig.mockResolvedValue({ enableHistorySync: false } as never);

    await expect(getClientService().downloadData(remoteContent)).resolves.toEqual(
      downloadedContent
    );
    expect(mockDownloadForStorage).toHaveBeenCalledTimes(1);
    expect(mockDownloadForSyncClipboard).not.toHaveBeenCalled();
  });

  it('should use downloadForStorage when server is syncclipboard and history sync is disabled', async () => {
    mockConfigService.getActiveServer.mockResolvedValue({
      type: 'syncclipboard',
      url: 'https://sync.example.com',
    });
    mockConfigService.getConfig.mockResolvedValue({ enableHistorySync: false } as never);

    await getClientService().downloadData(remoteContent);

    expect(mockDownloadForStorage).toHaveBeenCalledTimes(1);
    expect(mockDownloadForStorage).toHaveBeenCalledWith(remoteContent, undefined, undefined);
    expect(mockDownloadForSyncClipboard).not.toHaveBeenCalled();
  });

  it('should use downloadForSyncClipboard when server is syncclipboard and history sync is enabled', async () => {
    mockConfigService.getActiveServer.mockResolvedValue({
      type: 'syncclipboard',
      url: 'https://sync.example.com',
    });
    mockConfigService.getConfig.mockResolvedValue({ enableHistorySync: true } as never);

    await getClientService().downloadData(remoteContent);

    expect(mockDownloadForSyncClipboard).toHaveBeenCalledTimes(1);
    expect(mockDownloadForSyncClipboard).toHaveBeenCalledWith(remoteContent, undefined, undefined);
    expect(mockDownloadForStorage).not.toHaveBeenCalled();
  });
});
