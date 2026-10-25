import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react-native';
import type { ClipboardContentType } from '@/types/api';
import { resolveClipboardIcon } from './clipboardTypeIcons';

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
