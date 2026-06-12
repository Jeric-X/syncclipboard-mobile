import * as Crypto from 'expo-crypto';
import { sha256 } from 'js-sha256';

jest.mock('expo-crypto');
jest.mock('js-sha256');

describe('Hash Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateTextHash', () => {
    const { calculateTextHash } = require('../utils/hash');

    it('should calculate hash for empty string', async () => {
      const mockHasher = {
        update: jest.fn().mockReturnThis(),
        hex: jest
          .fn()
          .mockReturnValue('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
      };
      (sha256.create as unknown as jest.Mock).mockReturnValue(mockHasher);

      const result = await calculateTextHash('');
      expect(result).toBe('E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855');
    });

    it('should return empty string for null input', async () => {
      const result = await calculateTextHash(null as unknown as string);
      expect(result).toBe('');
    });

    it('should calculate hash using js-sha256', async () => {
      const mockHasher = {
        update: jest.fn().mockReturnThis(),
        hex: jest.fn().mockReturnValue('abc123'),
      };
      (sha256.create as unknown as jest.Mock).mockReturnValue(mockHasher);

      const result = await calculateTextHash('test text');

      expect(sha256.create).toHaveBeenCalled();
      expect(mockHasher.update).toHaveBeenCalledWith('test text');
      expect(mockHasher.hex).toHaveBeenCalled();
      expect(result).toBe('ABC123');
    });

    it('should throw AbortError when signal is aborted before', async () => {
      const abortController = new AbortController();
      abortController.abort();

      await expect(calculateTextHash('test', abortController.signal)).rejects.toThrow(
        'Operation was aborted'
      );
    });

    it('should throw AbortError when signal is aborted during', async () => {
      const mockHasher = {
        update: jest.fn().mockImplementation(() => {
          throw new Error('Operation was aborted');
        }),
        hex: jest.fn().mockReturnValue('abc123'),
      };
      (sha256.create as unknown as jest.Mock).mockReturnValue(mockHasher);

      const abortController = new AbortController();

      await expect(calculateTextHash('test', abortController.signal)).rejects.toThrow();
    });
  });

  describe('calculateBase64Hash', () => {
    const { calculateBase64Hash } = require('../utils/hash');

    it('should return empty string for empty input', async () => {
      const result = await calculateBase64Hash('');
      expect(result).toBe('');
    });

    it('should calculate hash using expo-crypto', async () => {
      (Crypto.digestStringAsync as jest.Mock).mockResolvedValue('abc123');

      const result = await calculateBase64Hash('dGVzdA==');

      expect(Crypto.digestStringAsync).toHaveBeenCalledWith(
        Crypto.CryptoDigestAlgorithm.SHA256,
        'dGVzdA==',
        { encoding: Crypto.CryptoEncoding.HEX }
      );
      expect(result).toBe('ABC123');
    });

    it('should throw AbortError when signal is aborted', async () => {
      const abortController = new AbortController();
      abortController.abort();

      await expect(calculateBase64Hash('dGVzdA==', abortController.signal)).rejects.toThrow(
        'Operation was aborted'
      );
    });
  });

  describe('calculateBase64ContentHash', () => {
    const { calculateBase64ContentHash } = require('../utils/hash');

    it('should return empty string for empty input', async () => {
      const result = await calculateBase64ContentHash('');
      expect(result).toBe('');
    });

    it('should decode base64 and calculate hash', async () => {
      (sha256 as unknown as jest.Mock).mockReturnValue('abc123');

      const result = await calculateBase64ContentHash('dGVzdA==');

      expect(sha256).toHaveBeenCalled();
      expect(result).toBe('ABC123');
    });

    it('should throw AbortError when signal is aborted', async () => {
      const abortController = new AbortController();
      abortController.abort();

      await expect(calculateBase64ContentHash('dGVzdA==', abortController.signal)).rejects.toThrow(
        'Operation was aborted'
      );
    });
  });

  describe('calculateGroupHash', () => {
    // Use real sha256 for Group hash tests
    const actualSha256 = jest.requireActual('js-sha256') as {
      sha256: ReturnType<typeof import('js-sha256').sha256.create>;
    };
    const { calculateGroupHash } = require('../utils/hash');

    beforeEach(() => {
      // Override the global mock to use the real sha256 implementation
      (sha256.create as jest.Mock).mockImplementation(() => {
        const hasher = (actualSha256 as unknown as typeof import('js-sha256')).sha256.create();
        return hasher;
      });
    });

    it('should produce deterministic hash for same input', () => {
      const entries = [
        { relativePath: 'a.txt', isDirectory: false, length: 100, contentHash: 'ABC123' },
        { relativePath: 'b.txt', isDirectory: false, length: 200, contentHash: 'DEF456' },
      ];

      const hash1 = calculateGroupHash(entries);
      const hash2 = calculateGroupHash(entries);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9A-F]{64}$/); // 64 hex chars
    });

    it('should produce same hash regardless of input order', () => {
      const entries1 = [
        { relativePath: 'b.txt', isDirectory: false, length: 200, contentHash: 'DEF456' },
        { relativePath: 'a.txt', isDirectory: false, length: 100, contentHash: 'ABC123' },
      ];
      const entries2 = [
        { relativePath: 'a.txt', isDirectory: false, length: 100, contentHash: 'ABC123' },
        { relativePath: 'b.txt', isDirectory: false, length: 200, contentHash: 'DEF456' },
      ];

      expect(calculateGroupHash(entries1)).toBe(calculateGroupHash(entries2));
    });

    it('should produce different hash for different content', () => {
      const entries1 = [
        { relativePath: 'a.txt', isDirectory: false, length: 100, contentHash: 'ABC123' },
      ];
      const entries2 = [
        { relativePath: 'a.txt', isDirectory: false, length: 200, contentHash: 'ABC123' },
      ];

      expect(calculateGroupHash(entries1)).not.toBe(calculateGroupHash(entries2));
    });

    it('should handle directory entries', () => {
      const entries = [
        { relativePath: 'folder/', isDirectory: true, length: 0, contentHash: '' },
        { relativePath: 'folder/a.txt', isDirectory: false, length: 50, contentHash: 'FFF' },
      ];

      const hash = calculateGroupHash(entries);
      expect(hash).toMatch(/^[0-9A-F]{64}$/);
    });

    it('should sort non-ASCII filenames by UTF-8 byte order', () => {
      // UTF-8: 中文 (E4 B8 AD E6 96 87) vs 日本 (E6 97 A5 E6 9C AC)
      // E4 < E6, so 中文 comes before 日本
      const entries = [
        { relativePath: '日本.txt', isDirectory: false, length: 10, contentHash: 'AAA' },
        { relativePath: '中文.txt', isDirectory: false, length: 10, contentHash: 'BBB' },
      ];

      // Should be deterministic and hash-like
      const hash = calculateGroupHash(entries);
      expect(hash).toMatch(/^[0-9A-F]{64}$/);

      // Reverse order should give same hash (sorted internally)
      const entriesReversed = [...entries].reverse();
      expect(calculateGroupHash(entriesReversed)).toBe(hash);
    });

    it('should produce consistent hash with known test vector', () => {
      // Test vector matching desktop/server algorithm
      // Entry: F|test.txt|42|ABC123\0
      // SHA256 of UTF-8: should be deterministic
      const entries = [
        { relativePath: 'test.txt', isDirectory: false, length: 42, contentHash: 'ABC123' },
      ];

      const hash = calculateGroupHash(entries);

      // The expected hash can be verified against desktop implementation
      // F|test.txt|42|ABC123\0 → UTF-8 → SHA256
      const expected = sha256
        .create()
        .update(new TextEncoder().encode('F|test.txt|42|ABC123\0'))
        .hex()
        .toUpperCase();
      expect(hash).toBe(expected);
    });
  });
});
