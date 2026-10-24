import React from 'react';
// @ts-expect-error React Native 的 Jest 依赖提供 renderer，但未附带类型声明。
import TestRenderer, { act } from 'react-test-renderer';
import { Animated, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { TransferQueueModal } from '../components/TransferQueueModal';

jest.mock('react-native-feather', () => ({
  X: 'X',
  Upload: 'Upload',
  Download: 'Download',
  AlertCircle: 'AlertCircle',
  Clock: 'Clock',
  CheckCircle: 'CheckCircle',
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../hooks/useTheme', () => ({ useTheme: () => ({ theme: { colors: {} } }) }));
jest.mock('../utils', () => ({ formatFileSize: (bytes: number) => `${bytes} B` }));
jest.mock('../services/history/HistoryTransferQueue', () => ({
  getHistoryTransferQueue: jest.fn(),
}));
jest.mock('../stores/transferQueueStore', () => ({
  useTransferQueueStore: () => ({
    tasks: [mockTask],
    subscribe: mockSubscribe,
    pendingCount: 0,
    activeCount: 1,
  }),
}));

const mockSubscribe = jest.fn(() => jest.fn());
let mockTask = {
  profileId: 'image',
  displayName: 'image.png',
  type: 'download',
  status: 'running',
  progress: -1,
  bytesTransferred: 8192,
  totalBytes: -1,
};
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousActEnvironment: boolean | undefined;
let root: ReturnType<typeof TestRenderer.create>;
const start = jest.fn();
const stop = jest.fn();

beforeEach(() => {
  previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT;
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  mockTask = {
    ...mockTask,
    status: 'running',
    progress: -1,
    bytesTransferred: 8192,
    totalBytes: -1,
  };
  jest.spyOn(Animated, 'loop').mockReturnValue({ start, stop, reset: jest.fn() });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  jest.restoreAllMocks();
  jest.clearAllMocks();
  testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

async function render(visible = true) {
  await act(async () => {
    const screen = <TransferQueueModal visible={visible} onClose={jest.fn()} />;
    if (root) root.update(screen);
    else root = TestRenderer.create(screen);
  });
}

it('未知总大小时滚动显示，不伪装成固定百分比，并继续更新已传输字节数', async () => {
  await render();
  const bar = root.root.findByProps({ accessibilityRole: 'progressbar' });
  expect(bar.props.accessibilityValue).toEqual({ text: 'transfer.unknownTotalSize' });
  await act(async () => bar.props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
  expect(start).toHaveBeenCalledTimes(1);
  expect(Animated.loop).toHaveBeenCalledTimes(1);
  mockTask = { ...mockTask, bytesTransferred: 16384 };
  await render();
  expect(JSON.stringify(root.toJSON())).toContain('16384 B');
  expect(start).toHaveBeenCalledTimes(1);
  await render(false);
  expect(stop).toHaveBeenCalledTimes(1);
});

it('获得总大小后停止滚动，改为实际进度', async () => {
  await render();
  const bar = root.root.findByProps({ accessibilityRole: 'progressbar' });
  await act(async () => bar.props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
  mockTask = { ...mockTask, progress: 50, bytesTransferred: 16384, totalBytes: 32768 };
  await render();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(
    root.root.findAll(
      (node: { props: { style?: StyleProp<ViewStyle> } }) =>
        StyleSheet.flatten(node.props.style)?.width === '50%'
    ).length
  ).toBeGreaterThan(0);
});

it('任务结束后停止动画', async () => {
  await render();
  const bar = root.root.findByProps({ accessibilityRole: 'progressbar' });
  await act(async () => bar.props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
  mockTask = { ...mockTask, status: 'completed', progress: 100 };
  await render();
  expect(stop).toHaveBeenCalledTimes(1);
});
