import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { CurrentClipboardCard } from '../components/CurrentClipboardCard';

jest.mock('../components/ClipboardTypeIcon', () => ({ ClipboardTypeIcon: () => null }));
jest.mock('../hooks/useTheme', () => ({ useTheme: () => ({ theme: { colors: {} } }) }));
jest.mock('../stores', () => ({ useSettingsStore: () => ({ config: {} }) }));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('../utils/index', () => ({ formatSizeWithType: () => '' }));
jest.mock('../utils/fileActions', () => ({}));
jest.mock('../utils/clipboard/clipboardContentUtils', () => ({}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const originalPlatform = Platform.OS;
afterEach(() => {
  Platform.OS = originalPlatform;
});

it.each(['ios', 'android'] as const)(
  'offers download and then copy for remote file-backed text on %s',
  (os) => {
    Platform.OS = os;
    const content = { type: 'Text' as const, text: 'preview', hasData: true, fileName: 'full.txt' };
    const onAction = jest.fn();
    const onCopy = jest.fn();
    const onWordPick = jest.fn();
    const props = { isRemote: true, onAction, onCopy, onWordPick };
    const card = render(<CurrentClipboardCard {...props} clipboard={content} />);
    expect(card.queryByText('common.copy')).toBeNull();
    expect(card.queryByText('clipboard.wordPick')).toBeNull();
    fireEvent.press(card.getByText('clipboard.download'));
    expect(onAction).toHaveBeenCalledTimes(1);

    const downloaded = { ...content, fileUri: 'file:///full.txt' };
    card.rerender(<CurrentClipboardCard {...props} clipboard={downloaded} />);
    expect(card.queryByText('clipboard.download')).toBeNull();
    fireEvent.press(card.getByText('common.copy'));
    expect(onCopy).toHaveBeenCalledWith(downloaded);
    fireEvent.press(card.getByText('clipboard.wordPick'));
    expect(onWordPick).toHaveBeenCalledWith(downloaded);
  }
);
