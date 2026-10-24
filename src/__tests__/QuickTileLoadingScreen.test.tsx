import React from 'react';
// @ts-expect-error React Native 的 Jest 依赖提供 renderer，但未附带类型声明。
import TestRenderer, { act } from 'react-test-renderer';
import {
  BackHandler,
  Platform,
  StyleSheet,
  Text,
  ToastAndroid,
  TouchableOpacity,
} from 'react-native';
import { QuickTileLoadingScreen } from '../screens/QuickTileLoadingScreen';
import { localClipboard } from '../services/clipboard/LocalClipboard';
import {
  fetchRemoteClipboard,
  setLocalClipboardFromRemote,
} from '../services/sync/ClipboardSyncActions';
import { saveToGallery } from '../utils/fileActions';
import { SyncDirection } from '../types/sync';
import type { ClipboardContent } from '../types/clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { saveContentDataToDirectory } from '../utils/clipboard/clipboardContentUtils';
import type { ProgressInfo } from 'native-util';

jest.mock('react-native-feather', () => ({
  Copy: 'Copy',
  ExternalLink: 'ExternalLink',
  Download: 'Download',
  Share: 'Share',
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('../hooks/useTheme', () => ({ useTheme: () => ({ theme: { colors: {} } }) }));
jest.mock('../utils/index', () => ({
  isTextInvalid: (text: string) => !text?.trim(),
  formatFileSize: (size: number) => `${size} B`,
}));
jest.mock('../utils/fileActions', () => ({
  openFile: jest.fn(),
  shareFile: jest.fn(),
  saveToGallery: jest.fn(),
}));
jest.mock('../utils/clipboard/clipboardContentUtils', () => ({
  saveContentDataToDirectory: jest.fn(),
}));
jest.mock('../services/sync/SyncFileSaveService', () => ({ saveSyncFileToUserPath: jest.fn() }));
jest.mock('../services/clipboard/LocalClipboard', () => ({
  localClipboard: { setClipboardContent: jest.fn() },
}));
jest.mock('../services/sync/ClipboardSyncActions', () => ({
  fetchRemoteClipboard: jest.fn(),
  setLocalClipboardFromRemote: jest.fn(),
  setRemoteClipboard: jest.fn(),
}));
jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: { requestDirectoryPermissionsAsync: jest.fn() },
}));

const mockTranslate = (key: string) => key;
const complete = jest.fn();
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousActEnvironment: boolean | undefined;
let previousPlatform: typeof Platform.OS;
let root: ReturnType<typeof TestRenderer.create>;
let backPress: () => boolean | null | undefined;
const imageContent: ClipboardContent = {
  type: 'Image',
  text: '',
  fileUri: 'file:///cache/image.png',
  fileName: 'image.png',
  timestamp: 1,
  hasData: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  previousPlatform = Platform.OS;
  Platform.OS = 'android';
  previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT;
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  jest.mocked(localClipboard.setClipboardContent).mockReset().mockResolvedValue();
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    backPress = handler;
    return { remove: jest.fn() };
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  jest.restoreAllMocks();
  Platform.OS = previousPlatform;
  testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  jest.useRealTimers();
});

async function render(content: ClipboardContent) {
  jest.mocked(fetchRemoteClipboard).mockResolvedValue(content);
  jest.mocked(setLocalClipboardFromRemote).mockResolvedValue(content);
  await act(async () => {
    root = TestRenderer.create(
      <QuickTileLoadingScreen
        direction={SyncDirection.Download}
        onLoadingComplete={complete}
        overlayMode
      />
    );
  });
}

function button(label: string) {
  return root.root
    .findAllByType(TouchableOpacity)
    .find(
      (node: { props: { accessibilityLabel?: string } }) => node.props.accessibilityLabel === label
    );
}

function buttonLayout(node: { props: { style: unknown } }) {
  const { width, minWidth, flexBasis, flexGrow, flexDirection } = StyleSheet.flatten(
    node.props.style as never
  );
  return { width, minWidth, flexBasis, flexGrow, flexDirection };
}

it('图片复制完成后才返回；复制期间禁用其他操作、返回和重复点击', async () => {
  let finish!: () => void;
  jest.mocked(localClipboard.setClipboardContent).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render(imageContent);
  const copy = button('quickTile.copyAndReturn');
  expect(copy).toBeDefined();
  let copying!: Promise<void>;
  await act(async () => {
    copying = copy.props.onPress();
    void copy.props.onPress();
  });
  expect(localClipboard.setClipboardContent).toHaveBeenCalledTimes(1);
  expect(localClipboard.setClipboardContent).toHaveBeenCalledWith(imageContent, true);
  expect(complete).not.toHaveBeenCalled();
  expect(button('clipboard.save').props.disabled).toBe(true);
  expect(button('common.back').props.disabled).toBe(true);
  expect(backPress()).toBe(true);
  expect(complete).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await copying;
  });
  expect(complete).toHaveBeenCalledTimes(1);
  expect(saveToGallery).not.toHaveBeenCalled();
});

it('复制失败保留预览并显示错误，允许重试成功后返回', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest
    .mocked(localClipboard.setClipboardContent)
    .mockRejectedValueOnce(new Error('copy unavailable'));
  await render(imageContent);
  expect(button('quickTile.copyAndReturn')).toBeDefined();
  await act(async () => button('quickTile.copyAndReturn').props.onPress());
  expect(complete).not.toHaveBeenCalled();
  expect(JSON.stringify(root.toJSON())).toContain('clipboard.copyFailed');
  expect(button('quickTile.copyAndReturn').props.disabled).toBe(false);
  await act(async () => button('quickTile.copyAndReturn').props.onPress());
  expect(complete).toHaveBeenCalledTimes(1);
});

it('保存期间阻止复制和关闭，保存完成后恢复操作且保留预览', async () => {
  let finish!: () => void;
  jest.mocked(saveToGallery).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render(imageContent);
  const saveLayout = buttonLayout(button('clipboard.save'));
  let saving!: Promise<void>;
  await act(async () => {
    saving = button('clipboard.save').props.onPress();
  });
  expect(button('quickTile.copyAndReturn').props.disabled).toBe(true);
  expect(button('common.back').props.disabled).toBe(true);
  expect(buttonLayout(button('clipboard.save'))).toEqual(saveLayout);
  expect(backPress()).toBe(true);
  expect(complete).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await saving;
  });
  expect(button('quickTile.copyAndReturn').props.disabled).toBe(false);
  expect(button('common.back').props.disabled).toBe(false);
  expect(complete).not.toHaveBeenCalled();
});

it.each(['File', 'Group'] as const)('%s 选择目录后无需等待进度即可取消保存', async (type) => {
  let selectDirectory!: (value: { granted: true; directoryUri: string }) => void;
  jest
    .mocked(FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          selectDirectory = resolve;
        })
    );
  let saveSignal!: AbortSignal;
  let reportProgress!: (info: ProgressInfo) => void;
  jest.mocked(saveContentDataToDirectory).mockImplementationOnce(
    (_content, _uri, signal, onProgress) =>
      new Promise<void>((_resolve, reject) => {
        saveSignal = signal!;
        reportProgress = onProgress!;
        signal!.addEventListener('abort', () =>
          reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
        );
      })
  );
  await render({ ...imageContent, type });
  const saveLayout = buttonLayout(button('clipboard.save'));
  let saving!: Promise<void>;
  await act(async () => {
    saving = button('clipboard.save').props.onPress();
  });
  expect(button('clipboard.save').props.disabled).toBe(true);
  expect(buttonLayout(button('clipboard.save'))).toEqual(saveLayout);
  await act(async () => {
    selectDirectory({ granted: true, directoryUri: 'content://directory' });
  });
  expect(button('common.cancel').props.disabled).toBe(false);
  expect(buttonLayout(button('common.cancel'))).toEqual(saveLayout);
  await act(async () => {
    reportProgress({ bytesTransferred: 50, totalBytes: 100, progress: 0.5 });
  });
  expect(buttonLayout(button('common.cancel'))).toEqual(saveLayout);
  expect(
    root.root
      .findAllByType(Text)
      .some((node: { props: { children: unknown } }) => node.props.children === '50% 50 B / 100 B')
  ).toBe(true);
  expect(button('50% 50 B / 100 B')).toBeUndefined();
  await act(async () => {
    button('common.cancel').props.onPress();
    await saving;
  });
  expect(saveSignal.aborted).toBe(true);
  expect(button('clipboard.save').props.disabled).toBe(false);
  expect(button('common.back').props.disabled).toBe(false);
  expect(complete).not.toHaveBeenCalled();
});

it('带链接文字通过完整内容复制接口再次复制并返回', async () => {
  jest.useFakeTimers();
  const content: ClipboardContent = {
    type: 'Text',
    text: '说明 https://example.com',
    fileUri: 'file:///cache/full-text.txt',
    hasData: true,
    timestamp: 1,
  };
  await render(content);
  await act(async () => jest.advanceTimersByTime(5000));
  expect(complete).not.toHaveBeenCalled();
  expect(button('clipboard.openLink')).toBeDefined();
  expect(button('quickTile.copyAndReturn')).toBeDefined();
  await act(async () => button('quickTile.copyAndReturn').props.onPress());
  expect(localClipboard.setClipboardContent).toHaveBeenCalledWith(content, true);
  expect(complete).toHaveBeenCalledTimes(1);
});

it('普通文字复制成功后显示预览和自动返回提示，停留 1.2 秒再关闭', async () => {
  jest.useFakeTimers();
  await render({ type: 'Text', text: '普通文字', timestamp: 1, hasData: false });
  expect(setLocalClipboardFromRemote).toHaveBeenCalled();
  expect(JSON.stringify(root.toJSON())).toContain('普通文字');
  expect(JSON.stringify(root.toJSON())).toContain('quickTile.textCopied');
  expect(JSON.stringify(root.toJSON())).toContain('common.autoReturning');
  expect(button('clipboard.open')).toBeUndefined();
  expect(button('clipboard.save')).toBeUndefined();
  expect(button('common.back')).toBeUndefined();
  expect(complete).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(1199));
  expect(complete).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(1));
  expect(complete).toHaveBeenCalledTimes(1);
});

it('文字预览提前退出后清理自动关闭定时器', async () => {
  jest.useFakeTimers();
  await render({ type: 'Text', text: '普通文字', timestamp: 1, hasData: false });
  await act(async () => root.unmount());
  root = undefined;
  await act(async () => jest.advanceTimersByTime(5000));
  expect(complete).not.toHaveBeenCalled();
});

it.each(['File', 'Group'] as const)('%s 不显示图片复制操作，保留对应文件操作', async (type) => {
  await render({ ...imageContent, type });
  expect(button('quickTile.copyAndReturn')).toBeUndefined();
  expect(button('clipboard.save')).toBeDefined();
  expect(Boolean(button('clipboard.open'))).toBe(type === 'File');
  expect(Boolean(button('clipboard.share'))).toBe(type === 'File');
  expect(complete).not.toHaveBeenCalled();
});
