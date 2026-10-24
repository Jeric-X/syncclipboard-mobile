import { HistoryTransferQueue } from '../services/history/HistoryTransferQueue';
import type { TransferTask } from '../services/history/HistoryTransferQueue';
import type { IHistoryAPI } from '../api/history';
import { createHistoryItem } from '../types/clipboard';
import type { ClipboardContent } from '../types/clipboard';
import type { ProgressDetail } from '../types/progress';

jest.mock('../storage/HistoryStorage', () => ({
  HistoryStorage: { getInstance: () => mockStorage },
}));
jest.mock('../utils/fileStorage', () => ({
  getHistoryFileDir: () => ({ uri: 'file://history', exists: true }),
}));
jest.mock('../utils/clipboard/convert', () => ({
  historyItemToContent: (item: { type: string; profileHash: string }) => ({
    type: item.type,
    profileHash: item.profileHash,
  }),
  historyItemToDto: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  File: jest.fn((dir: { uri: string }, name: string) => ({ uri: `${dir.uri}/${name}` })),
}));

const mockStorage = { getItem: jest.fn(), updateItem: jest.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function download(
  size: number | undefined,
  info: ProgressDetail,
  type: ClipboardContent['type'] = 'Image'
) {
  mockStorage.getItem.mockResolvedValue(
    createHistoryItem({
      type,
      profileHash: 'hash',
      text: 'download',
      hasData: true,
      dataName: 'data',
      size,
      timestamp: 0,
    })
  );
  const downloadData = jest.fn<
    ReturnType<IHistoryAPI['downloadData']>,
    Parameters<IHistoryAPI['downloadData']>
  >(async (_profileId, uri, _signal, report) => {
    report?.(info);
    return uri;
  });
  const queue = new HistoryTransferQueue();
  queue.setHistoryAPI({ downloadData } as unknown as IHistoryAPI);
  const snapshots: TransferTask[] = [];
  queue.onTaskStatusChanged((task) => snapshots.push({ ...task }));
  const report = jest.fn();
  const result = await queue.executeImmediateDownload(
    {
      type,
      profileHash: 'hash',
      text: 'download',
      hasData: true,
    },
    report
  );
  expect(result.fileUri).toBe('file://history/data');
  expect(queue.getActiveCount()).toBe(0);
  expect(snapshots.at(-1)?.status).toBe('completed');
  return {
    task: snapshots.find((task) => task.status === 'running' && task.bytesTransferred > 0)!,
    report,
  };
}

it.each(['Image', 'File'] as const)(
  '下载 %s 缺少响应长度时，用记录大小计算队列和外部回调进度',
  async (type) => {
    const { task, report } = await download(
      32768,
      {
        bytesTransferred: 8192,
        totalBytes: -1,
        progress: -1,
      },
      type
    );
    expect(task).toMatchObject({ bytesTransferred: 8192, totalBytes: 32768, progress: 25 });
    expect(report).toHaveBeenCalledWith({
      bytesTransferred: 8192,
      totalBytes: 32768,
      progress: 0.25,
    });
  }
);

it('响应提供总长度时优先使用，不使用记录大小', async () => {
  const { task, report } = await download(32768, {
    bytesTransferred: 8192,
    totalBytes: 16384,
    progress: 0.5,
  });
  expect(task).toMatchObject({ totalBytes: 16384, progress: 50 });
  expect(report).toHaveBeenCalledWith({ bytesTransferred: 8192, totalBytes: 16384, progress: 0.5 });
});

it.each([undefined, 0, -1, NaN, Infinity])(
  '记录大小为 %s 且缺少响应长度时保留未知进度',
  async (size) => {
    const { task, report } = await download(size, {
      bytesTransferred: 8192,
      totalBytes: -1,
      progress: -1,
    });
    expect(task.progress).toBe(-1);
    expect(report.mock.calls[0][0].progress).toBe(-1);
  }
);

it('记录大小小于实际传输大小时，进度不超出 100%', async () => {
  const { task, report } = await download(4096, {
    bytesTransferred: 8192,
    totalBytes: -1,
    progress: -1,
  });
  expect(task.progress).toBe(100);
  expect(report.mock.calls[0][0].progress).toBe(1);
});
