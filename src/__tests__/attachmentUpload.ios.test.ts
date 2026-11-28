import { File } from 'expo-file-system';
import { createUploadTask, readAsStringAsync } from 'expo-file-system/legacy';
import {
  fileMD5Base64,
  stringMD5Base64,
  uploadFile,
  uploadMultipart,
} from '@/api/clients/attachmentUpload.ios';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-boundary' }));
jest.mock('expo-file-system/legacy', () => ({
  createUploadTask: jest.fn(),
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
  FileSystemSessionType: { FOREGROUND: 1 },
}));

const photo = 'file:///cache/photo.png';
const endpoint = 'https://server.example/file/photo.png';
const cancel = jest.fn().mockResolvedValue(undefined);
const send = jest.fn();
const removeBody = jest.fn();
let body: Buffer[];

beforeEach(() => {
  jest.clearAllMocks();
  body = [];
  jest.mocked(File).mockImplementation(
    (uri) =>
      ({
        uri: uri === photo ? photo : 'file:///cache/form.tmp',
        size: 3,
        exists: true,
        create: jest.fn(),
        delete: removeBody,
        open: () => ({
          readBytes: () => Uint8Array.of(97, 98, 99),
          writeBytes: (bytes: Uint8Array) => body.push(Buffer.from(bytes)),
          close: jest.fn(),
        }),
      }) as unknown as File
  );
  send.mockResolvedValue({ status: 201, body: '' });
  jest
    .mocked(createUploadTask)
    .mockReturnValue({ uploadAsync: send, cancelAsync: cancel } as unknown as ReturnType<
      typeof createUploadTask
    >);
});

it('uses native transfer byte counts and preserves server conflict details', async () => {
  send.mockResolvedValue({ status: 409, body: '{"version":2}' });
  const progress = jest.fn();
  const upload = uploadFile(endpoint, {}, photo, undefined, progress);
  jest
    .mocked(createUploadTask)
    .mock.calls[0][3]?.({ totalBytesSent: 3, totalBytesExpectedToSend: 4 });
  expect(progress).toHaveBeenCalledWith({ bytesTransferred: 3, totalBytes: 4, progress: 0.75 });
  await expect(upload).rejects.toMatchObject({ statusCode: 409, response: { version: 2 } });
});

it('generates S3 Content-MD5 for both text and file bytes', async () => {
  expect(stringMD5Base64('abc')).toBe('kAFQmDzST7DWlj99KOF/cg==');
  await expect(fileMD5Base64(photo)).resolves.toBe('kAFQmDzST7DWlj99KOF/cg==');
});

it('sends history fields and attachment in one multipart body and removes it on failure', async () => {
  send.mockRejectedValue(new Error('offline'));
  await expect(uploadMultipart(endpoint, {}, { type: 'Image' }, photo)).rejects.toThrow('offline');
  expect(Buffer.concat(body).toString()).toBe(
    [
      '--test-boundary',
      'Content-Disposition: form-data; name="type"',
      '',
      'Image',
      '--test-boundary',
      'Content-Disposition: form-data; name="data"; filename="photo.png"',
      'Content-Type: application/octet-stream',
      '',
      'abc',
      '--test-boundary--',
      '',
    ].join('\r\n')
  );
  expect(removeBody).toHaveBeenCalledTimes(1);
});

it('hashes read-only attachments using range reads', async () => {
  jest.mocked(File).mockImplementation(
    () =>
      ({
        uri: photo,
        exists: true,
        size: 3,
        open: () => {
          throw new Error('Read-only file');
        },
      }) as unknown as File
  );
  jest.mocked(readAsStringAsync).mockResolvedValue('YWJj');
  await expect(fileMD5Base64(photo)).resolves.toBe('kAFQmDzST7DWlj99KOF/cg==');
  expect(readAsStringAsync).toHaveBeenCalledWith(photo, {
    encoding: 'base64',
    position: 0,
    length: 3,
  });
});
