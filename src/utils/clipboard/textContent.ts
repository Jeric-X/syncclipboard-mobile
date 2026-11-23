import type { ClipboardContent } from '@/types/clipboard';
import { calculateTextHash } from '@/utils/hash';

export async function createContentFromText(
  text: string,
  options?: { signal?: AbortSignal }
): Promise<ClipboardContent> {
  const profileHash = await calculateTextHash(text, options?.signal);
  return {
    type: 'Text',
    text,
    profileHash,
    localClipboardHash: profileHash,
    hasData: false,
    timestamp: Date.now(),
  };
}
