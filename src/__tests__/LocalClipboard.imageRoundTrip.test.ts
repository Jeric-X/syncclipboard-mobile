import { File } from 'expo-file-system';
import { nativeSetClipboardImageFromFile } from 'native-util';
import * as clipboardProxy from '@/utils/clipboardProxy';
import { calculateFileHash, calculateTextHash } from '@/utils/hash';
import { LocalClipboard, localClipboard } from '@/services/clipboard/LocalClipboard';
import { getClipboardChangedHandler } from '@/services/sync/ClipboardChangedHandler';
import { uploadLocalClipboard } from '@/services/sync/ClipboardSyncActions';
import { historyStorage } from '@/storage/HistoryStorage';
import type { ClipboardContent } from '@/types/clipboard';

jest.mock('@/utils/clipboardProxy', () => ({
  getStringAsync: jest.fn(),
  hasStringAsync: jest.fn(),
  hasImageAsync: jest.fn(() => Promise.resolve(true)),
  saveImageToFileAsync: jest.fn(() =>
    Promise.resolve({ filePath: 'file:///readback.png', mimeType: 'image/png' })
  ),
}));
jest.mock('native-util', () => ({ nativeSetClipboardImageFromFile: jest.fn() }));
jest.mock('@/utils/hash', () => ({
  calculateFileHash: jest.fn(),
  calculateTextHash: jest.fn(),
}));
jest.mock('@/utils/index', () => ({ isTextInvalid: (text?: string) => !text }));
jest.mock('@/utils/fileStorage', () => ({
  CLIPBOARD_TEMP_DIR: { uri: 'file:///temp', exists: true },
  prepareTempFilePath: (name: string) => `file:///temp/${name}`,
}));
jest.mock('@/storage/HistoryStorage', () => ({
  historyStorage: { getItemByLocalHash: jest.fn(() => Promise.resolve(null)) },
}));
jest.mock('@/services/ConfigService', () => ({
  configService: {
    getConfig: () => Promise.resolve({ autoSync: true }),
    getActiveServer: () => Promise.resolve({ id: 'server' }),
  },
}));
jest.mock('@/services/sync/ClipboardSyncActions', () => ({
  uploadLocalClipboard: jest.fn(() => Promise.resolve(true)),
  downloadRemoteClipboard: jest.fn(),
}));
jest.mock('@/services/sync/RemoteClipboardMonitor', () => ({
  remoteClipboardMonitor: { refresh: jest.fn(() => Promise.resolve()) },
}));
jest.mock('@/services/history/HistoryService', () => ({
  historyService: {
    addRemoteContent: jest.fn(() => Promise.resolve({ fileUri: 'file:///screenshot.png' })),
  },
}));
jest.mock('@/services/notification/ForegroundNotification', () => ({
  updateForegroundNotification: jest.fn(),
}));
jest.mock('@/services/StartupTiming', () => ({
  getStartupElapsedMs: () => 3_000,
  logStartupPoint: jest.fn(),
  measureStartup: (_name: string, operation: () => unknown) => operation(),
}));
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));

const image: ClipboardContent = {
  type: 'Image',
  text: 'screenshot.png',
  fileName: 'screenshot.png',
  fileUri: 'file:///screenshot.png',
  fileSize: 1024,
  profileHash: 'remote-profile-hash',
  hasData: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  getClipboardChangedHandler().resetHashes();
  (nativeSetClipboardImageFromFile as jest.Mock).mockResolvedValue(true);
  (calculateFileHash as jest.Mock).mockResolvedValue('image-file-hash');
  (calculateTextHash as jest.Mock).mockResolvedValue('new-local-profile-hash');
  (clipboardProxy.hasStringAsync as jest.Mock).mockResolvedValue(false);
  (clipboardProxy.getStringAsync as jest.Mock).mockResolvedValue(
    'content://com.jericx.syncclipboardmobile.NativeUtilFileProvider/screenshot.png'
  );
  (File as unknown as jest.Mock).mockImplementation((uri: string) => ({
    uri,
    name: uri.split('/').pop(),
    size: 1024,
    exists: true,
    delete: jest.fn(),
  }));
});

afterEach(() => {
  localClipboard.registerCopyLifecycleCallbacks({ onBeforeCopy: () => {}, onAfterCopy: () => {} });
  localClipboard.registerRemoteCopiedCallback(null);
});

it('远程图片自动复制后，恢复监听读回同一图片不会重新上传', async () => {
  const handler = getClipboardChangedHandler();
  let readback: ClipboardContent | null = null;
  localClipboard.registerRemoteCopiedCallback((copied) =>
    handler.setLastLocalProfileHash(copied.profileHash!)
  );
  localClipboard.registerCopyLifecycleCallbacks({
    onBeforeCopy: () => {},
    onAfterCopy: async () => {
      readback = await localClipboard.getClipboardContent();
      if (readback) await handler.handleAutoUpload(readback);
    },
  });

  await handler.processRemoteClipboardContent({ ...image, fileUri: undefined });

  expect(nativeSetClipboardImageFromFile).toHaveBeenCalledWith(image.fileUri);
  expect(readback).toMatchObject({
    profileHash: image.profileHash,
    fileName: image.fileName,
    localClipboardHash: 'image-file-hash',
  });
  expect(uploadLocalClipboard).not.toHaveBeenCalled();
  expect(clipboardProxy.getStringAsync).not.toHaveBeenCalled();

  (calculateFileHash as jest.Mock).mockResolvedValue('different-file-hash');
  const changed = await localClipboard.getClipboardContent();
  await handler.handleAutoUpload(changed!);
  expect(uploadLocalClipboard).toHaveBeenCalledWith(changed);
});

it('剪贴板真正包含 URI 文本时仍按文字读取，不误判为图片', async () => {
  const text = 'content://example/document';
  (clipboardProxy.hasStringAsync as jest.Mock).mockResolvedValue(true);
  (clipboardProxy.getStringAsync as jest.Mock).mockResolvedValue(text);
  const clipboard = new LocalClipboard();

  expect(await clipboard.getClipboardContent()).toMatchObject({ type: 'Text', text });
  expect(clipboardProxy.hasImageAsync).not.toHaveBeenCalled();
});

it('同一图片以新文件名再次复制时使用最新身份，实际新图片仍生成新身份', async () => {
  const clipboard = new LocalClipboard();
  await clipboard.setClipboardContent(image, true);
  const renamed = {
    ...image,
    text: 'renamed.png',
    fileName: 'renamed.png',
    profileHash: 'renamed-profile-hash',
  };
  await clipboard.setClipboardContent(renamed, true);

  expect(await clipboard.getClipboardContent()).toMatchObject({
    profileHash: renamed.profileHash,
    fileName: renamed.fileName,
  });
  expect(historyStorage.getItemByLocalHash).not.toHaveBeenCalled();

  (calculateFileHash as jest.Mock).mockResolvedValue('different-file-hash');
  expect(await clipboard.getClipboardContent()).toMatchObject({
    profileHash: 'new-local-profile-hash',
    localClipboardHash: 'different-file-hash',
  });
  expect(clipboardProxy.saveImageToFileAsync).toHaveBeenCalledTimes(2);
});

it('写入失败不会覆盖上一次成功复制的图片身份', async () => {
  const clipboard = new LocalClipboard();
  await clipboard.setClipboardContent(image, true);
  (nativeSetClipboardImageFromFile as jest.Mock).mockResolvedValueOnce(false);
  const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(
      clipboard.setClipboardContent({ ...image, profileHash: 'failed-copy' }, true)
    ).rejects.toThrow('Failed to set image to clipboard');
    expect(await clipboard.getClipboardContent()).toMatchObject({ profileHash: image.profileHash });
  } finally {
    logError.mockRestore();
  }
});
