import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import type { ServerConfig, ProfileDto } from '@/types/api';
import type { ISyncClipboardAPI } from '@/api/clients/APIClient';
import { calculateTextHash, isValidHash } from '@/utils/hash';

type TextClient = Pick<ISyncClipboardAPI, 'getClipboardSnapshot' | 'putClipboard'>;

export const MAX_INLINE_TEXT_LENGTH = 1000;
const BASELINE_KEY = '@syncclipboard:ios:resume-text';

/** 全应用只保留当前目标的一组基准。 */
export function clearResumeTextBaseline(): Promise<void> {
  return AsyncStorage.removeItem(BASELINE_KEY);
}

export function resumeTargetIdentity(server?: ServerConfig): string {
  return server
    ? JSON.stringify([
        server.id,
        server.type,
        server.url,
        server.username ?? '',
        server.password ?? '',
        server.bucketName ?? '',
        server.objectPrefix ?? '',
      ])
    : '';
}

interface TextBaseline {
  target: string;
  local: string;
  remote: string | null;
}

function parseBaseline(raw: string | null, target: string): TextBaseline | null {
  if (!raw) return null;
  try {
    const previous = JSON.parse(raw);
    return previous?.target === target &&
      isValidHash(previous.local) &&
      (previous.remote === null || isValidHash(previous.remote))
      ? previous
      : null;
  } catch {
    return null;
  }
}

export type IosTextAction = 'resume' | 'upload' | 'copy' | 'refresh' | 'paste';

interface TextObservations {
  completed?: boolean;
  failed?: boolean;
  local?: ProfileDto | null;
  remote: ProfileDto | null;
}

/** Expo 可能把拒绝读取返回为空串；有图片或文件 URL 的剪贴板也不能按文本覆盖。 */
async function readLocalText(signal: AbortSignal): Promise<ProfileDto | null> {
  if ((await Clipboard.hasImageAsync()) || signal.aborted) return null;
  const hasUrl = await Clipboard.hasUrlAsync();
  if (signal.aborted) return null;
  let text: string | null;
  if (hasUrl) {
    const url = await Clipboard.getUrlAsync();
    if (signal.aborted || !url || url.startsWith('file:')) return null;
    const hasText = await Clipboard.hasStringAsync();
    if (signal.aborted) return null;
    text = hasText ? await Clipboard.getStringAsync() : url;
  } else {
    text = await Clipboard.getStringAsync();
  }
  if (!text || text.length > MAX_INLINE_TEXT_LENGTH) return null;
  return { type: 'Text', text, hash: await calculateTextHash(text), hasData: false };
}

async function saveBaseline(next: TextBaseline) {
  try {
    await AsyncStorage.setItem(BASELINE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** 比较同一服务器相邻两次的短文本快照，传输成功后才一起确认两端指纹。 */
export async function syncResumeText(
  server: ServerConfig,
  client: TextClient,
  signal: AbortSignal,
  action: IosTextAction = 'resume',
  actionText?: string
): Promise<TextObservations | undefined> {
  if (!server.id || !client.getClipboardSnapshot || server.type === 's3' || signal.aborted) return;
  let localChangedDuringCheck = false;
  const samplesLocal = action === 'resume' || action === 'upload';
  const listener = samplesLocal
    ? Clipboard.addClipboardListener(() => {
        localChangedDuringCheck = true;
      })
    : null;
  let local: ProfileDto | null = null;
  try {
    if (samplesLocal) local = await readLocalText(signal);
    if (signal.aborted) return;
    // 等系统粘贴授权结束后才取远端版本，避免根据弹窗出现前的 profile 上传。
    const [{ profile, condition }, raw, target] = await Promise.all([
      client.getClipboardSnapshot(signal),
      action === 'resume' ? AsyncStorage.getItem(BASELINE_KEY) : null,
      calculateTextHash(resumeTargetIdentity(server)),
    ]);
    if (signal.aborted) return;
    const observed: TextObservations = { local: samplesLocal ? local : undefined, remote: profile };
    const inlineText =
      profile.type === 'Text' && profile.hasData === false && typeof profile.text === 'string';
    const shortText = inlineText && profile.text.length <= MAX_INLINE_TEXT_LENGTH;
    const remoteHash = shortText ? await calculateTextHash(profile.text) : null;
    if (signal.aborted) return;
    if (remoteHash) {
      observed.remote =
        profile.hash && profile.hash.toUpperCase() !== remoteHash
          ? null
          : { ...profile, hash: remoteHash };
    }
    const validProfile = observed.remote !== null;
    if (!validProfile) observed.failed = true;
    const missingProfile = !!condition && 'If-None-Match' in condition;
    // SyncClipboard Server 读取 profile 失败时也可能返回带哈希的空文本。
    const ambiguousEmpty = inlineText && !profile.text && server.type === 'syncclipboard';
    if (missingProfile || ambiguousEmpty) observed.remote = null;
    if (localChangedDuringCheck) observed.local = null;
    if (action === 'refresh') return { ...observed, completed: !!observed.remote };

    if (action === 'paste') {
      // 输入框允许编辑。提交的是用户提供的正文，不能据此声称系统板也相同。
      if (!validProfile || !actionText || actionText.length > MAX_INLINE_TEXT_LENGTH)
        return observed;
      const supplied: ProfileDto = {
        type: 'Text',
        hasData: false,
        text: actionText,
        hash: await calculateTextHash(actionText),
      };
      if (signal.aborted) return;
      await client.putClipboard(supplied, signal, condition);
      // 用户输入不是系统板快照。保留最后一对同时确认的指纹。
      if (!signal.aborted) return { completed: true, remote: supplied };
      return;
    }

    if (action === 'upload' || action === 'copy') {
      const upload = action === 'upload';
      const selected = upload ? observed.local : shortText && observed.remote;
      if (
        !validProfile ||
        (actionText !== undefined && actionText !== (upload ? observed.local?.text : profile.text))
      )
        return observed;
      if (!selected || !selected.hash) return observed;
      if (upload) {
        await client.putClipboard(selected, signal, condition);
      } else if (!(await Clipboard.setStringAsync(selected.text))) {
        return observed;
      }
      if (signal.aborted) return;
      const baselineSaved =
        (upload && localChangedDuringCheck) ||
        (await saveBaseline({ target, local: selected.hash, remote: selected.hash }));
      if (!signal.aborted)
        return {
          completed: true,
          failed: !baselineSaved,
          local: upload && localChangedDuringCheck ? null : selected,
          remote: selected,
        };
      return;
    }

    if (
      !local?.hash ||
      !observed.local ||
      !validProfile ||
      ambiguousEmpty ||
      !shortText ||
      !remoteHash
    )
      return observed;
    const previous = parseBaseline(raw, target);
    const next: TextBaseline = {
      target,
      local: local.hash,
      remote: missingProfile ? null : remoteHash,
    };
    let copied = false;
    if (previous && next.local !== next.remote) {
      const localChanged = previous.local !== next.local;
      const remoteChanged = previous.remote !== next.remote;
      if (localChanged && !remoteChanged) {
        // 兼容不返回强 ETag 的 SyncClipboard/WebDAV 部署。此时最新 GET 与 PUT
        // 之间仍可能有其他客户端发布；协议没有可供比较写入的版本。
        await client.putClipboard(local, signal, condition);
        observed.remote = local;
        next.remote = next.local;
      } else if (remoteChanged && !localChanged && !missingProfile) {
        copied = await Clipboard.setStringAsync(profile.text);
        if (!copied) return;
        observed.local = observed.remote;
        next.local = remoteHash;
      }
    }
    // 退出当前会话时保留上次基准；下次看到两端相等即可确认已完成的传输。
    if (signal.aborted) return;
    if (
      (!localChangedDuringCheck || copied) &&
      (previous?.local !== next.local || previous.remote !== next.remote)
    ) {
      if (!(await saveBaseline(next))) observed.failed = true;
    }
    if (localChangedDuringCheck && !copied) observed.local = null;
    if (!signal.aborted) return observed;
  } catch (error) {
    if (signal.aborted) return;
    console.warn(
      '[iOS] Resume text sync failed:',
      error instanceof Error ? error.message : 'unknown error'
    );
    return {
      local: samplesLocal ? (localChangedDuringCheck ? null : local) : undefined,
      remote: null,
      failed: true,
    };
  } finally {
    listener?.remove();
  }
}
