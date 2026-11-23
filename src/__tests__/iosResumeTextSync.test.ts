import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { calculateTextHash } from '@/utils/hash';
import type { ServerConfig, ProfileDto } from '@/types/api';
import { syncResumeText } from '@/services/sync/iosResumeTextSync';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('expo-clipboard', () => ({
  addClipboardListener: jest.fn(() => ({ remove: jest.fn() })),
  getStringAsync: jest.fn(),
  setStringAsync: jest.fn(),
  hasImageAsync: jest.fn(),
  hasStringAsync: jest.fn(),
  hasUrlAsync: jest.fn(),
  getUrlAsync: jest.fn(),
}));

const server: ServerConfig = { id: 'home', type: 'webdav', url: 'https://home.example' };
let records: Map<string, string>;
let local: string;
let profile: ProfileDto;
const client = {
  getClipboardSnapshot: jest.fn(async () => ({ profile })),
  putClipboard: jest.fn(async (next: ProfileDto) => {
    profile = next;
  }),
};
const check = (target = server, signal = new AbortController().signal) =>
  syncResumeText(target, client, signal);

beforeEach(() => {
  jest.clearAllMocks();
  local = 'X';
  profile = { type: 'Text', text: 'X', hasData: false };
  records = new Map();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (key) => records.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    records.set(key, value);
  });
  jest.mocked(Clipboard.getStringAsync).mockImplementation(async () => local);
  jest.mocked(Clipboard.setStringAsync).mockImplementation(async (text) => {
    local = text;
    return true;
  });
});

it('initializes independently, preserves conflicts, then publishes only a later local edit', async () => {
  local = 'first';
  await check();
  local = 'A';
  profile.text = 'B';
  await check();
  await check();
  expect(client.putClipboard).not.toHaveBeenCalled();
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  local = 'C';
  await check();
  await check();
  expect(client.putClipboard).toHaveBeenCalledTimes(1);
  expect(profile).toEqual({
    type: 'Text',
    text: 'C',
    hasData: false,
    hash: await calculateTextHash('C'),
  });
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
});

it('copies a remote-only change once and confirms equal independent edits without a transfer', async () => {
  await check();
  profile.text = '远程😀';
  await check();
  await check();
  local = profile.text = 'both';
  await check();
  expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1);
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('远程😀');
  expect(client.putClipboard).not.toHaveBeenCalled();
});

it('keeps only one baseline and initializes again when the target changes', async () => {
  await check();
  local = 'new';
  await check({ ...server, id: 'other' });
  expect(records.size).toBe(1);
  await check({ ...server, username: 'other' });
  await check({ ...server, url: 'https://elsewhere.example' });
  expect(client.putClipboard).not.toHaveBeenCalled();
});

it('does not turn a denied or oversized local read into a transfer', async () => {
  await check();
  const first = new Map(records);
  profile.text = 'changed';
  for (local of ['', 'x'.repeat(1001)]) await check();
  expect(records).toEqual(first);
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  expect(client.putClipboard).not.toHaveBeenCalled();
});

it('skips attachments and profiles with a hash that does not match the inline text', async () => {
  await check();
  const first = new Map(records);
  profile = { type: 'Text', text: 'preview', hasData: true, dataName: 'body.txt' };
  await check();
  profile = { type: 'Text', text: 'wrong', hasData: false, hash: await calculateTextHash('right') };
  await check();
  expect(records).toEqual(first);
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
});

it('retains the baseline after failed reads, publications and clipboard writes', async () => {
  await check();
  const first = new Map(records);
  client.getClipboardSnapshot.mockRejectedValueOnce(new Error('offline'));
  expect(await check()).toMatchObject({ failed: true, local: { text: local } });
  local = 'new';
  client.putClipboard.mockRejectedValueOnce(new Error('write failed'));
  expect(await check()).toMatchObject({ failed: true, local: { text: local } });
  local = 'X';
  profile.text = 'next';
  jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false);
  await check();
  expect(records).toEqual(first);
  await check();
  expect(local).toBe('next');
});

it('keeps the confirmed phone and server previews when baseline persistence fails', async () => {
  await check();
  const before = new Map(records);
  profile.text = 'new remote';
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage unavailable'));
  const observed = await check();
  expect(local).toBe('new remote');
  expect(observed).toMatchObject({ failed: true, local: { text: local }, remote: { text: local } });
  expect(records).toEqual(before);
});

it('drops a canceled sample before writing either side', async () => {
  await check();
  const first = new Map(records);
  const controller = new AbortController();
  jest.mocked(Clipboard.getStringAsync).mockImplementationOnce(async () => {
    controller.abort();
    return 'stale';
  });
  await check(server, controller.signal);
  expect(records).toEqual(first);
  expect(client.putClipboard).not.toHaveBeenCalled();
});

it('can publish the first local edit after establishing an empty WebDAV baseline', async () => {
  profile.text = '';
  await check();
  expect(client.putClipboard).not.toHaveBeenCalled();
  local = 'x'.repeat(1000);
  await check();
  expect(profile.text).toBe(local);
  profile.text = '';
  delete profile.hash;
  const missing = { profile, condition: { 'If-None-Match': '*' as const } };
  client.getClipboardSnapshot.mockResolvedValueOnce(missing);
  await check();
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
});

it('uploads a subsequent edit after observing a missing WebDAV profile', async () => {
  await check();
  profile = { type: 'Text', text: '', hasData: false };
  const missing = { profile, condition: { 'If-None-Match': '*' as const } };
  client.getClipboardSnapshot.mockResolvedValueOnce(missing);
  await check();
  expect(local).toBe('X');
  local = 'Y';
  client.getClipboardSnapshot.mockResolvedValueOnce(missing);
  await check();
  expect(profile.text).toBe('Y');
});

it('skips an explicit copy of an oversized inline preview', async () => {
  profile.text = 'x'.repeat(1001);
  const result = await syncResumeText(
    server,
    client,
    new AbortController().signal,
    'copy',
    profile.text
  );
  expect(result?.completed).toBeFalsy();
  expect(records.size).toBe(0);
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
});

it('leaves a pasteboard image with a text representation untouched', async () => {
  await check();
  profile.text = 'changed';
  jest.mocked(Clipboard.hasImageAsync).mockResolvedValueOnce(true);
  await check();
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  expect(Clipboard.getStringAsync).toHaveBeenCalledTimes(1);
});

it('stops after a denied URL read without requesting the text representation', async () => {
  jest.mocked(Clipboard.hasUrlAsync).mockResolvedValueOnce(true);
  jest.mocked(Clipboard.getUrlAsync).mockResolvedValueOnce(null);
  await check();
  expect(Clipboard.getStringAsync).not.toHaveBeenCalled();
  expect(client.putClipboard).not.toHaveBeenCalled();
  expect(records.size).toBe(0);
});

it('passes the sampled write condition and retains the baseline after a rejected conditional PUT', async () => {
  await check();
  const first = new Map(records);
  local = 'A';
  const condition = { 'If-Match': '"revision-1"' };
  const snapshot = { profile, condition };
  client.getClipboardSnapshot.mockResolvedValueOnce(snapshot);
  client.putClipboard.mockRejectedValueOnce(new Error('412 Precondition Failed'));
  expect(await check()).toMatchObject({ failed: true, local: { text: local } });
  expect(client.putClipboard).toHaveBeenCalledWith(
    expect.objectContaining({ text: 'A' }),
    expect.anything(),
    condition
  );
  expect(records).toEqual(first);
});

it('retains the independently observed side when the other cannot participate', async () => {
  local = '';
  expect(await check()).toMatchObject({ local: null, remote: { text: 'X' } });
  local = 'A';
  profile = { type: 'Image', text: 'preview', hasData: true, dataName: 'image.png' };
  expect(await check()).toMatchObject({ local: { text: 'A' }, remote: profile });
  expect(records.size).toBe(0);
});

it('leaves the baseline untouched if backgrounded during a write, then confirms equal snapshots', async () => {
  await check();
  const controller = new AbortController();
  profile.text = 'B';
  jest.mocked(Clipboard.setStringAsync).mockImplementationOnce(async (text) => {
    local = text;
    controller.abort();
    return true;
  });
  expect(await check(server, controller.signal)).toBeUndefined();
  const previous = records.get('@syncclipboard:ios:resume-text');
  expect(JSON.parse(previous!).local).toBe(await calculateTextHash('X'));
  await check();
  expect(local).toBe('B');
  expect(client.putClipboard).not.toHaveBeenCalled();
});

it('establishes a fresh baseline when returning to a previously used server', async () => {
  await check();
  await check({ ...server, id: 'office' });
  local = 'other text';
  await check();
  expect(client.putClipboard).not.toHaveBeenCalled();
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  expect(records.size).toBe(1);
  local = 'next change';
  await check();
  expect(profile.text).toBe(local);
});

it('manual copy resolves a conflict and the next remote edit still downloads', async () => {
  await check();
  local = 'A';
  profile.text = 'B';
  await check();
  await syncResumeText(server, client, new AbortController().signal, 'copy');
  expect(local).toBe('B');
  profile.text = 'C';
  await check();
  expect(local).toBe('C');
});

it('allows a first manual upload and refreshes a preview without accessing the pasteboard', async () => {
  local = 'first upload';
  await syncResumeText(server, client, new AbortController().signal, 'upload');
  expect(profile.text).toBe(local);
  profile = { type: 'Text', text: 'latest', hasData: false };
  const previous = new Map(records);
  const result = await syncResumeText(server, client, new AbortController().signal, 'refresh');
  expect(result?.remote?.text).toBe('latest');
  expect(Clipboard.getStringAsync).toHaveBeenCalledTimes(1);
  expect(records).toEqual(previous);
});

it('refreshes a stale preview without copying unseen text', async () => {
  profile.text = 'new';
  const result = await syncResumeText(server, client, new AbortController().signal, 'copy', 'old');
  expect(result?.remote?.text).toBe('new');
  expect(result?.completed).toBeFalsy();
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  expect(records.size).toBe(0);
});

it('publishes text from the manual paste field without asserting it was on the system clipboard', async () => {
  await check();
  const result = await syncResumeText(
    server,
    client,
    new AbortController().signal,
    'paste',
    'edited text'
  );
  expect(result).toMatchObject({ completed: true, remote: { text: 'edited text' } });
  expect(Clipboard.getStringAsync).toHaveBeenCalledTimes(1);
  await check();
  expect(local).toBe('edited text');
  expect(profile.text).toBe('edited text');
});

it('preserves both edits when the paste field upload did not observe the changed local clipboard', async () => {
  await check();
  local = 'independent local edit';
  const before = new Map(records);
  await syncResumeText(
    server,
    client,
    new AbortController().signal,
    'paste',
    'explicit remote edit'
  );
  expect(records).toEqual(before);
  await check();
  expect(local).toBe('independent local edit');
  expect(profile.text).toBe('explicit remote edit');
});

it('applies a remote clear only when the empty profile is explicitly verified', async () => {
  await check();
  profile = { type: 'Text', text: '', hasData: false, hash: await calculateTextHash('') };
  await check();
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('');
});

it('keeps a confirmed remote publication but no paired baseline when local changes during a PUT', async () => {
  client.putClipboard.mockImplementationOnce(async (next) => {
    profile = next;
    jest.mocked(Clipboard.addClipboardListener).mock.calls.at(-1)![0]({ contentTypes: [] });
  });
  const result = await syncResumeText(server, client, new AbortController().signal, 'upload');
  expect(result).toMatchObject({ completed: true, local: null, remote: { text: 'X' } });
  expect(records.size).toBe(0);
});

it('does not clear the phone when SyncClipboard Server returns its empty fallback', async () => {
  const syncServer = { ...server, type: 'syncclipboard' as const };
  await check(syncServer);
  const first = new Map(records);
  profile = { type: 'Text', text: '', hasData: false, hash: await calculateTextHash('') };
  expect((await check(syncServer))?.remote).toBeNull();
  expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  expect(records).toEqual(first);
});

it('uses the copied excerpt when a string and its source URL are both present', async () => {
  jest.mocked(Clipboard.hasUrlAsync).mockResolvedValueOnce(true);
  jest.mocked(Clipboard.getUrlAsync).mockResolvedValueOnce('https://example.org');
  jest.mocked(Clipboard.hasStringAsync).mockResolvedValueOnce(true);
  expect((await check())?.local?.text).toBe('X');
});
