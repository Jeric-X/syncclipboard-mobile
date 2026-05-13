import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ClipboardContent } from '@/types/clipboard';

const LAST_CLIPBOARD_HASH_KEY = '@last_clipboard_hash';

export async function loadLastTrackedHash(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(LAST_CLIPBOARD_HASH_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as {
        localClipboardHash?: string;
        profileHash?: string;
      };
      return parsed.localClipboardHash ?? parsed.profileHash ?? null;
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveLastTrackedHash(content: ClipboardContent): void {
  const hash = content.localClipboardHash ?? content.profileHash ?? null;
  if (!hash) return;

  AsyncStorage.setItem(
    LAST_CLIPBOARD_HASH_KEY,
    JSON.stringify({
      localClipboardHash: content.localClipboardHash,
      profileHash: content.profileHash,
      type: content.type,
    })
  ).catch(() => {});
}
