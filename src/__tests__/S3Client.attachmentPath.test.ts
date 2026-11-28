import { S3Client } from '@/api/clients/S3Client';
import { uploadFile } from '@/api/clients/attachmentUpload';
import { nativeDownloadFile } from 'native-util';

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0' }));
jest.mock('native-util', () => ({ nativeDownloadFile: jest.fn() }));
jest.mock('@/api/clients/attachmentUpload', () => ({
  fileMD5Base64: jest.fn().mockResolvedValue('checksum'),
  uploadFile: jest.fn(),
}));

it('上传和下载使用同一个 S3 对象路径，保留文件名中的 URL 分隔符', async () => {
  const client = new S3Client({
    serviceURL: 'https://objects.example',
    bucketName: 'photos',
    forcePathStyle: true,
    accessKeyId: 'fixture',
    secretAccessKey: 'fixture',
  });
  const file = 'file:///cache/photo.png';
  const name = '分享 (1)#?.png';
  const url = 'https://objects.example/photos/file/' + '%E5%88%86%E4%BA%AB%20%281%29%23%3F.png';
  await client.putFile(name, file);
  await client.downloadFile(name, file);
  expect(jest.mocked(uploadFile).mock.calls[0][0]).toBe(url);
  expect(jest.mocked(nativeDownloadFile).mock.calls[0][0]).toBe(url);
});
