import { File } from 'expo-file-system';
import { nativeSetClipboardImageFromFile } from 'native-util';
import { LocalClipboard } from '@/services/clipboard/LocalClipboard';
import { historyStorage } from '@/storage/HistoryStorage';
import { calculateFileHash, calculateTextHash } from '@/utils/hash';
import { getHistoryFileUri } from '@/utils/fileStorage';
import * as clipboardProxy from '@/utils/clipboardProxy';
import { clipboardContentToItem, historyItemToContent } from '@/utils/clipboard/convert';
import { createContentFromFile } from '@/utils/clipboard/clipboardContentUtils';
import type { ClipboardContent } from '@/types/clipboard';

jest.mock('@/utils/clipboardProxy', () => ({
  getStringAsync: jest.fn().mockResolvedValue('content://clipboard/photo.png'),
  hasStringAsync: jest.fn().mockResolvedValue(false),
  hasImageAsync: jest.fn().mockResolvedValue(true),
  saveImageToFileAsync: jest.fn(),
}));
jest.mock('@/utils/index', () => ({ isTextInvalid: (text?: string) => !text }));
jest.mock('@/storage/HistoryStorage', () => ({
  historyStorage: { getItem: jest.fn(), updateItem: jest.fn(), getItemByLocalHash: jest.fn() },
}));
jest.mock('@/utils/hash', () => ({
  calculateFileHash: jest.fn(),
  calculateTextHash: jest.fn(),
  calculateFileProfileHash: jest.fn().mockResolvedValue('original-profile'),
}));
jest.mock('@/utils/fileActions', () => ({ copyFileToDirectory: jest.fn() }));
jest.mock('@/utils/fileStorage', () => ({
  CLIPBOARD_TEMP_DIR: { exists: true, uri: 'file:///temp/' },
  prepareTempFilePath: (name: string) => `file:///temp/${name}`,
  getHistoryFileUri: jest.fn(),
}));
jest.mock('native-util', () => ({
  nativeSetClipboardImageFromFile: jest.fn(),
  nativeCopyFile: jest.fn().mockResolvedValue(undefined),
}));

const content: ClipboardContent = {
  type: 'Image',
  text: 'photo.png',
  fileName: 'photo.png',
  fileUri: 'file:///history/photo.png',
  profileHash: 'original-profile',
  hasData: true,
};
const fileHash = 'A'.repeat(64);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(calculateFileHash).mockResolvedValue(fileHash);
  jest.mocked(nativeSetClipboardImageFromFile).mockResolvedValue(true);
  jest.mocked(File).mockImplementation(
    (uri) =>
      ({
        uri,
        name: String(uri).split('/').pop(),
        exists: true,
        size: 12,
        delete: jest.fn(),
      }) as unknown as File
  );
});

test('history conversions preserve the image byte hash in both directions', () => {
  const item = clipboardContentToItem({ ...content, localClipboardHash: fileHash });
  expect(item.localClipboardHash).toBe(fileHash);
  expect(historyItemToContent(item).localClipboardHash).toBe(fileHash);
});

test.each([false, true])(
  'copy repairs an old image before readback (remote=%s)',
  async (remote) => {
    let item = clipboardContentToItem(content);
    jest.mocked(historyStorage.getItem).mockImplementation(async () => item);
    jest.mocked(historyStorage.updateItem).mockImplementation(async (_, updates) => {
      item = { ...item, ...updates };
    });
    jest
      .mocked(historyStorage.getItemByLocalHash)
      .mockImplementation(async (hash) => (item.localClipboardHash === hash ? item : null));
    jest.mocked(getHistoryFileUri).mockResolvedValue(content.fileUri!);
    jest.mocked(clipboardProxy.saveImageToFileAsync).mockResolvedValue({
      filePath: 'file:///temp/random.png',
      mimeType: 'image/png',
    });
    const clipboard = new LocalClipboard();
    let readback: ClipboardContent | null = null;
    const remoteCopied = jest.fn();
    clipboard.registerRemoteCopiedCallback(remoteCopied);
    clipboard.registerCopyLifecycleCallbacks({
      onBeforeCopy: jest.fn(),
      onAfterCopy: async () => {
        readback = await clipboard.getClipboardContent();
      },
    });

    await clipboard.setClipboardContent(content, remote);

    expect(historyStorage.updateItem).toHaveBeenCalledWith(content.profileHash, {
      localClipboardHash: fileHash,
    });
    expect(readback).toMatchObject({
      profileHash: content.profileHash,
      fileName: content.fileName,
      localClipboardHash: fileHash,
    });
    expect(clipboardProxy.getStringAsync).not.toHaveBeenCalled();
    expect(remoteCopied).toHaveBeenCalledTimes(remote ? 1 : 0);
  }
);

test('a URI copied as actual text is still read as text', async () => {
  jest.mocked(clipboardProxy.hasStringAsync).mockResolvedValueOnce(true);
  jest.mocked(historyStorage.getItemByLocalHash).mockResolvedValue(null);
  jest.mocked(calculateTextHash).mockResolvedValue('text-profile');

  await expect(new LocalClipboard().getClipboardContent()).resolves.toMatchObject({
    type: 'Text',
    text: 'content://clipboard/photo.png',
  });
  expect(clipboardProxy.hasImageAsync).not.toHaveBeenCalled();
});

test('a failed image write restores monitoring and does not mark a remote copy', async () => {
  jest
    .mocked(historyStorage.getItem)
    .mockResolvedValue(clipboardContentToItem({ ...content, localClipboardHash: fileHash }));
  jest.mocked(nativeSetClipboardImageFromFile).mockResolvedValue(false);
  const clipboard = new LocalClipboard();
  const afterCopy = jest.fn();
  const remoteCopied = jest.fn();
  clipboard.registerCopyLifecycleCallbacks({ onBeforeCopy: jest.fn(), onAfterCopy: afterCopy });
  clipboard.registerRemoteCopiedCallback(remoteCopied);
  await expect(clipboard.setClipboardContent(content, true)).rejects.toThrow('Failed to set image');
  expect(afterCopy).toHaveBeenCalledTimes(1);
  expect(remoteCopied).not.toHaveBeenCalled();
  expect(historyStorage.updateItem).not.toHaveBeenCalled();
});

test('importing an image retains a byte hash instead of its filename-dependent profile hash', async () => {
  const imported = await createContentFromFile(
    'file:///picked/photo.png',
    'photo.png',
    'image/png',
    12
  );
  expect(imported.fileUri).toBe('file:///picked/photo.png');
  expect(imported.profileHash).toBe('original-profile');
  expect(clipboardContentToItem(imported).localClipboardHash).toBe(fileHash);
});

test('readback preserves the selected record when another image has identical bytes', async () => {
  const selected = clipboardContentToItem({ ...content, localClipboardHash: fileHash });
  const other = { ...selected, profileHash: 'other-profile', dataName: 'other.png' };
  jest.mocked(historyStorage.getItem).mockResolvedValue(selected);
  jest.mocked(historyStorage.getItemByLocalHash).mockResolvedValue(other);
  jest.mocked(getHistoryFileUri).mockResolvedValue(content.fileUri!);
  jest
    .mocked(clipboardProxy.saveImageToFileAsync)
    .mockResolvedValue({ filePath: 'file:///temp/random.png', mimeType: 'image/png' });
  const clipboard = new LocalClipboard();
  await clipboard.setClipboardContent(content, true);
  await expect(clipboard.getClipboardContent()).resolves.toMatchObject({
    profileHash: content.profileHash,
    fileName: content.fileName,
  });
});

test('a different system image is not mistaken for the last copied record', async () => {
  jest
    .mocked(historyStorage.getItem)
    .mockResolvedValue(clipboardContentToItem({ ...content, localClipboardHash: fileHash }));
  jest.mocked(historyStorage.getItemByLocalHash).mockResolvedValue(null);
  const clipboard = new LocalClipboard();
  await clipboard.setClipboardContent(content, true);
  jest.mocked(calculateFileHash).mockResolvedValue('B'.repeat(64));
  jest.mocked(calculateTextHash).mockResolvedValue('new-profile');
  jest
    .mocked(clipboardProxy.saveImageToFileAsync)
    .mockResolvedValue({ filePath: 'file:///temp/random.png', mimeType: 'image/png' });
  await expect(clipboard.getClipboardContent()).resolves.toMatchObject({
    profileHash: 'new-profile',
    localClipboardHash: 'B'.repeat(64),
  });
});
