import { DedupedOperation } from '@/utils/DedupedOperation';

it('同一图片的旧上传已取消但尚未结束时，新分享会立即重新上传', async () => {
  const op = new DedupedOperation<string, string, number>((a, b) => a === b);
  const controller = new AbortController();
  let finish!: (value: string) => void;
  let report!: (value: number) => void;
  const old = op.execute('image', undefined, controller.signal, (_, notify) => {
    report = notify;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  controller.abort();
  const progress = jest.fn();
  const next = op.execute('image', progress, null, async (_, notify) => {
    report(1);
    notify(2);
    return 'new';
  });
  finish('old');
  await expect(next).resolves.toBe('new');
  await expect(old).resolves.toBe('old');
  expect(progress.mock.calls).toEqual([[2]]);
});
