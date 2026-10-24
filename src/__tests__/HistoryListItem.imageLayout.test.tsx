import React from 'react';
// @ts-expect-error React Native 的 Jest 依赖提供 renderer，但未附带类型声明。
import TestRenderer, { act } from 'react-test-renderer';
import { Image, StyleSheet, View } from 'react-native';
import { HistoryListItem } from '../components/HistoryListItem';
import { createHistoryItem } from '../types/clipboard';

jest.mock('react-native-feather', () => ({
  Copy: 'Copy',
  Download: 'Download',
  Share: 'Share',
  Link2: 'Link2',
  Scissors: 'Scissors',
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
  MaterialCommunityIcons: 'MaterialCommunityIcons',
}));
jest.mock('../components/StarIcon', () => ({ StarIcon: 'StarIcon' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../hooks/useTheme', () => ({ useTheme: () => ({ theme: { colors: {} } }) }));
jest.mock('../stores/transferQueueStore', () => ({
  useTransferQueueStore: () => [],
}));
jest.mock('../stores', () => ({ useSettingsStore: () => 'off' }));
jest.mock('../services/history/HistoryTransferQueue', () => ({
  getHistoryTransferQueue: jest.fn(),
}));
jest.mock('../utils/index', () => ({
  getProfileId: () => 'Image_test',
  formatSizeWithType: () => '',
  formatFileSize: () => '',
}));

const item = createHistoryItem({
  type: 'Image',
  text: '',
  profileHash: 'test',
  hasData: true,
  fileUri: 'file:///test.png',
  timestamp: 1,
});
const props = { item, onCopy: jest.fn(), onShare: jest.fn(), onLongPress: jest.fn() };
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousActEnvironment: boolean | undefined;
let root: ReturnType<typeof TestRenderer.create>;

beforeEach(() => {
  previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT;
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

it.each([
  ['竖图', 600, 1200],
  ['横图', 1200, 600],
])('%s 完整预览在进入和退出多选时由当前宽度按原比例布局', async (_name, width, height) => {
  await act(async () => {
    root = TestRenderer.create(<HistoryListItem {...props} showFullImage />);
  });
  const preview = () => root.root.findByType(Image);
  await act(async () => {
    preview().props.onLoad({ nativeEvent: { source: { width, height } } });
  });

  for (const isMultiSelectMode of [false, true, false]) {
    await act(async () => {
      root.update(
        <HistoryListItem
          {...props}
          showFullImage
          isMultiSelectMode={isMultiSelectMode}
          isSelected={isMultiSelectMode}
        />
      );
    });
    if (isMultiSelectMode) {
      const card = root.root
        .findAllByType(View)
        .find(
          (view: { props: React.ComponentProps<typeof View> }) =>
            StyleSheet.flatten(view.props.style)?.borderWidth === 2
        );
      expect(card).toBeDefined();
      // 多选行中的图片卡片必须能够收缩，不能由竖图测量尺寸撑出屏幕。
      expect(StyleSheet.flatten(card.props.style).flexShrink).toBe(1);
    }
    const style = StyleSheet.flatten(preview().props.style);
    expect(style.width).toBe('100%');
    // 高度应随本次原生布局的宽度变化，不能保留上一次 onLayout 计算的固定高度。
    expect(style.aspectRatio).toBe(width / height);
    expect(style.height).toBeUndefined();
  }
});

it('未加载尺寸时和关闭完整预览时保持限高缩略图', async () => {
  await act(async () => {
    root = TestRenderer.create(<HistoryListItem {...props} showFullImage />);
  });
  expect(StyleSheet.flatten(root.root.findByType(Image).props.style).height).toBe(180);
  await act(async () => {
    root.root.findByType(Image).props.onLoad({
      nativeEvent: { source: { width: 600, height: 1200 } },
    });
    root.update(<HistoryListItem {...props} showFullImage={false} />);
  });
  expect(StyleSheet.flatten(root.root.findByType(Image).props.style).height).toBe(180);
});
