/**
 * Clipboard Utilities
 * 剪贴板工具函数导出
 */

export {
  dtoToHistoryItem as dtoToClipboardItem,
  historyItemToDto as clipboardItemToDto,
  contentToProfileDto,
  profileDtoToContent,
  getExtensionFromMimeType,
  getExtensionFromFileName,
  getClipboardTypeDisplayName,
  getClipboardTypeIcon,
  validateClipboardContent,
  clipboardContentToItem,
} from './convert';
export type { ContentToProfileDtoOptions } from './convert';
export { getProfileId, parseProfileId } from './profileId';
