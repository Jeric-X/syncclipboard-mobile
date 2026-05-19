jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn(),
  CryptoDigestAlgorithm: {
    SHA256: 'SHA-256',
  },
  CryptoEncoding: {
    HEX: 'hex',
  },
}));

jest.mock('expo-clipboard', () => ({
  getStringAsync: jest.fn(),
  setStringAsync: jest.fn(),
  getImageAsync: jest.fn(),
  setImageAsync: jest.fn(),
}));

jest.mock('expo-file-system', () => {
  const makeDir = (base, ...parts) => {
    const path = [base, ...parts].join('/').replace(/\/+/g, '/');
    return {
      uri: path,
      exists: jest.fn().mockResolvedValue(false),
      create: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
      copy: jest.fn().mockResolvedValue(undefined),
      move: jest.fn().mockResolvedValue(undefined),
    };
  };
  const makeFile = (base, ...parts) => {
    const path = [base, ...parts].join('/').replace(/\/+/g, '/');
    return {
      uri: path,
      exists: jest.fn().mockResolvedValue(false),
      create: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      copy: jest.fn().mockResolvedValue(undefined),
      move: jest.fn().mockResolvedValue(undefined),
      info: jest.fn().mockReturnValue({ exists: true, size: 1000 }),
      open: jest.fn().mockReturnValue({
        readBytes: jest.fn().mockReturnValue(new Uint8Array(10)),
        close: jest.fn(),
      }),
    };
  };
  return {
    File: jest.fn().mockImplementation((...args) => makeFile(...args)),
    Directory: jest.fn().mockImplementation((...args) => makeDir(...args)),
    Paths: {
      document: 'file://documents',
      cache: 'file://cache',
      downloads: 'file://downloads',
    },
    DocumentDirectory: 'file://documents/',
    CacheDirectory: 'file://cache/',
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  },
}));

jest.mock('native-util', () => ({
  isNativeHashModuleAvailable: jest.fn().mockReturnValue(false),
  nativeCalculateFileHash: jest.fn(),
  nativeCopyFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@microsoft/signalr', () => ({
  HubConnectionBuilder: jest.fn().mockImplementation(() => ({
    withUrl: jest.fn().mockReturnThis(),
    withAutomaticReconnect: jest.fn().mockReturnThis(),
    configureLogging: jest.fn().mockReturnThis(),
    build: jest.fn(),
  })),
}));

global.setImmediate = jest.useRealTimers;
