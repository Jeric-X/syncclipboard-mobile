import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ClipboardContent } from '@/types/clipboard';
import { STORAGE_KEYS } from '@/types/storage';

export async function loadLastTrackedHash(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.HISTORY_TRACKER_LAST_HASH);
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
    STORAGE_KEYS.HISTORY_TRACKER_LAST_HASH,
    JSON.stringify({
      localClipboardHash: content.localClipboardHash,
      profileHash: content.profileHash,
      type: content.type,
    })
  ).catch(() => {});
}
