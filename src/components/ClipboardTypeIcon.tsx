import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react-native';
import FileEmpty02Icon from '@hugeicons/core-free-icons/FileEmpty02Icon';
import FileDigitIcon from '@hugeicons/core-free-icons/FileDigitIcon';
import AiFileIcon from '@hugeicons/core-free-icons/AiFileIcon';
import FileTypeIcon from '@hugeicons/core-free-icons/FileTypeIcon';
import FileLockedIcon from '@hugeicons/core-free-icons/FileLockedIcon';
import FileCodeIcon from '@hugeicons/core-free-icons/FileCodeIcon';
import FileDatabaseIcon from '@hugeicons/core-free-icons/FileDatabaseIcon';
import TextAlignLeft01Icon from '@hugeicons/core-free-icons/TextAlignLeft01Icon';
import File02Icon from '@hugeicons/core-free-icons/File02Icon';
import Image03Icon from '@hugeicons/core-free-icons/Image03Icon';
import FileImageIcon from '@hugeicons/core-free-icons/FileImageIcon';
import Folder02Icon from '@hugeicons/core-free-icons/Folder02Icon';
import FileSpreadsheetIcon from '@hugeicons/core-free-icons/FileSpreadsheetIcon';
import FileChartPieIcon from '@hugeicons/core-free-icons/FileChartPieIcon';
import FileArchiveIcon from '@hugeicons/core-free-icons/FileArchiveIcon';
import FileAudioIcon from '@hugeicons/core-free-icons/FileAudioIcon';
import FilePlayIcon from '@hugeicons/core-free-icons/FilePlayIcon';
import FileAxisThreeDIcon from '@hugeicons/core-free-icons/FileAxisThreeDIcon';
import type { ClipboardContentType } from '@/types/api';
import { classifyFileName } from '@/utils/fileCategory';

// 使用与桌面端相同的 Hugeicons 图标，通过单图标子路径静态导入，避免打包整个图标库。
const CLIPBOARD_ICONS = {
  File: FileEmpty02Icon,
  Binary: FileDigitIcon,
  AiModel: AiFileIcon,
  Font: FileTypeIcon,
  KeyFile: FileLockedIcon,
  Subtitle: FileCodeIcon,
  DiskImage: FileDatabaseIcon,
  Text: TextAlignLeft01Icon,
  TextFile: File02Icon,
  Image: Image03Icon,
  ImageFile: FileImageIcon,
  MultipleFiles: Folder02Icon,
  Spreadsheet: FileSpreadsheetIcon,
  Presentation: FileChartPieIcon,
  Archive: FileArchiveIcon,
  Code: FileCodeIcon,
  Audio: FileAudioIcon,
  Video: FilePlayIcon,
  Database: FileDatabaseIcon,
  ThreeDimensional: FileAxisThreeDIcon,
};

/** 文件图标由分类结果决定；Group 始终使用文件夹，不按传输 ZIP 分类。 */
function resolveClipboardIcon(type: ClipboardContentType, fileName?: string) {
  if (type === 'Text') return CLIPBOARD_ICONS.Text;
  if (type === 'Image') return CLIPBOARD_ICONS.Image;
  if (type === 'Group') return CLIPBOARD_ICONS.MultipleFiles;
  return CLIPBOARD_ICONS[classifyFileName(fileName)];
}

interface ClipboardTypeIconProps {
  type: ClipboardContentType;
  fileName?: string;
  size: number;
  color: string;
}

/** 统一剪贴板内容类型图标，颜色由所在页面的主题提供。 */
export function ClipboardTypeIcon({ type, fileName, size, color }: ClipboardTypeIconProps) {
  return (
    <HugeiconsIcon
      icon={resolveClipboardIcon(type, fileName)}
      size={size}
      color={color}
      strokeWidth={1.5}
    />
  );
}
