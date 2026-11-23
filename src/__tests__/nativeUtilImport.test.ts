import type * as NativeUtil from 'native-util';

function loadNativeUtil(os: 'ios' | 'android', requireNativeModule: jest.Mock) {
  jest.resetModules();
  jest.doMock('react-native', () => ({ Platform: { OS: os } }));
  jest.doMock('expo-modules-core', () => ({ requireNativeModule }));
  return jest.requireActual<typeof NativeUtil>('../../modules/native-util/src');
}

describe('native-util entry point', () => {
  it('loads on iOS with no native registration and exposes the platform fallbacks', async () => {
    const lookup = jest.fn((name: string) => {
      throw new Error(`Cannot find native module '${name}'`);
    });
    const util = loadNativeUtil('ios', lookup);

    expect(util.isNativeModuleAvailable).toBe(false);
    expect(util.isNativeHashModuleAvailable).toBe(false);
    expect(util.getLegacyHistoryDatabasePath()).toBeNull();
    await expect(util.nativeSetClipboardImageFromFile('file:///image.png')).resolves.toBe(false);
    await expect(util.nativeCalculateFileHash('file:///sample')).rejects.toThrow(
      'NativeUtilModule is not available on this platform'
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('loads the registered Android module and delegates to it', () => {
    const getSupportedAbis = jest.fn(() => ['arm64-v8a']);
    const lookup = jest.fn(() => ({ getSupportedAbis }));
    const util = loadNativeUtil('android', lookup);

    expect(lookup).toHaveBeenCalledWith('NativeUtilModule');
    expect(util.isNativeModuleAvailable).toBe(true);
    expect(util.isNativeHashModuleAvailable).toBe(true);
    expect(util.getSupportedAbis()).toEqual(['arm64-v8a']);
    expect(getSupportedAbis).toHaveBeenCalledTimes(1);
  });
});
