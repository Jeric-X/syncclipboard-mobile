import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';

jest.mock('@/utils/clipboardProxy', () => ({
  getStringAsync: jest.fn(),
  hasImageAsync: jest.fn(),
  saveImageToFileAsync: jest.fn(),
}));

jest.mock('@/utils/index', () => ({
  isTextInvalid: (text?: string | null) => !text,
}));

import { localClipboard } from '@/services/clipboard/LocalClipboard';
import type { ClipboardContent } from '@/types/clipboard';

const MockedFile = FileSystem.File as unknown as jest.Mock;

describe('LocalClipboard.setTextContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('copies full text from fileUri when text content only contains a preview', async () => {
    const fullText = '完整文本'.repeat(500);
    const fileText = jest.fn().mockResolvedValue(fullText);
    MockedFile.mockImplementation((uri: string) => ({
      uri,
      text: fileText,
    }));

    const content: ClipboardContent = {
      type: 'Text',
      text: '完整文本'.repeat(20) + '...',
      fileUri: 'file://documents/full-text.txt',
      fileName: 'full-text.txt',
      fileSize: fullText.length,
      profileHash: 'full-text-hash',
      localClipboardHash: 'full-text-hash',
      hasData: true,
      timestamp: Date.now(),
    };

    await localClipboard.setTextContent(content);

    expect(fileText).toHaveBeenCalledTimes(1);
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(fullText);
  });

  it('does not write an attachment if its session ends while reading the full text', async () => {
    const session = new AbortController();
    MockedFile.mockImplementationOnce(() => ({
      text: async () => {
        session.abort();
        return 'full text';
      },
    }));
    await expect(
      localClipboard.setTextContent(
        { type: 'Text', hasData: true, fileUri: 'file:///full.txt', text: 'preview' },
        session.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  });

  it('reports an unreadable attachment without copying its preview', async () => {
    MockedFile.mockImplementationOnce(() => ({
      text: jest.fn().mockRejectedValue(new Error('missing')),
    }));
    const request = jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('file missing'));
    try {
      await expect(
        localClipboard.setTextContent({
          type: 'Text',
          text: 'preview',
          fileUri: 'file:///missing.txt',
          hasData: true,
        })
      ).rejects.toThrow('file missing');
      expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
    }
  });

  it('falls back to fetch when File API cannot read the text file', async () => {
    const fullText = 'fallback full text';
    MockedFile.mockImplementation((uri: string) => ({
      uri,
      text: jest.fn().mockRejectedValue(new Error('file api failed')),
    }));
    global.fetch = jest.fn().mockResolvedValue({
      text: jest.fn().mockResolvedValue(fullText),
    }) as jest.Mock;

    const content: ClipboardContent = {
      type: 'Text',
      text: 'fallback...',
      fileUri: 'file://documents/fallback.txt',
      fileName: 'fallback.txt',
      hasData: true,
      profileHash: 'fallback-hash',
    };

    await localClipboard.setTextContent(content);

    expect(global.fetch).toHaveBeenCalledWith(content.fileUri);
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(fullText);
  });
});
