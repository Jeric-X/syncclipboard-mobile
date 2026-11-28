import { SyncClipboardClient } from '@/api/clients/SyncClipboardClient';
import { RecordNotFoundError, SyncConflictError } from '@/errors';
import type { ClipboardContent } from '@/types/clipboard';
import type { HistoryRecordDto } from '@/types/history';

jest.mock('@/utils', () => ({ isTextInvalid: (value?: string) => !value }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0' }));
const image: ClipboardContent = {
  type: 'Image',
  text: 'a.png',
  fileName: 'a.png',
  fileUri: 'file:///a.png',
  profileHash: 'hash',
  hasData: true,
};
const record: HistoryRecordDto = { type: 'Image', hash: 'hash', text: 'a.png', version: 1 };

it('uses the post-publication version and keeps publication successful if local confirmation fails', async () => {
  const client = new SyncClipboardClient({ baseURL: 'https://server.example' });
  let version = 1;
  jest.spyOn(client, 'getRecord').mockImplementation(async () => ({ ...record, version }));
  const publish = jest.spyOn(client, 'putClipboard').mockImplementation(async () => {
    version++;
  });
  const reconcile = jest.fn().mockRejectedValue(new Error('local write failed'));
  await expect(
    client.putContent(image, { history: { confirm: reconcile } })
  ).resolves.toBeUndefined();
  expect(publish).toHaveBeenCalledTimes(1);
  expect(reconcile).toHaveBeenCalledWith({ ...record, version: 2 });
});

it('does not publish an image when a conflicting record is deleted', async () => {
  const client = new SyncClipboardClient({ baseURL: 'https://server.example' });
  jest.spyOn(client, 'getRecord').mockRejectedValue(new RecordNotFoundError('Image-hash'));
  const conflict = new SyncConflictError('deleted', { ...record, isDeleted: true });
  jest.spyOn(client, 'uploadRecord').mockRejectedValue(conflict);
  const publish = jest.spyOn(client, 'putClipboard').mockResolvedValue();
  await expect(client.putContent(image)).rejects.toBe(conflict);
  expect(publish).not.toHaveBeenCalled();
});

it('uploads different images with the same filename under their own profile hashes', async () => {
  const client = new SyncClipboardClient({ baseURL: 'https://server.example' });
  jest.spyOn(client, 'getRecord').mockRejectedValue(new RecordNotFoundError('missing'));
  const upload = jest.spyOn(client, 'uploadRecord').mockResolvedValue(record);
  const publish = jest.spyOn(client, 'putClipboard').mockResolvedValue();
  await Promise.all(
    ['first', 'second'].map((profileHash) => client.putContent({ ...image, profileHash }))
  );
  expect(upload.mock.calls.map(([dto]) => dto.hash).sort()).toEqual(['first', 'second']);
  expect(publish.mock.calls.map(([dto]) => dto.dataName)).toEqual(['a.png', 'a.png']);
});
