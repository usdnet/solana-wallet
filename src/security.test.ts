/**
 * Tests for security utilities
 */

import { describe, it, expect } from 'vitest';
import {
  secureWipe,
  secureWipeString,
  isWebCryptoAvailable,
  secureRandomBytes,
  deriveKeyFromPassword,
  encryptData,
  decryptData,
  createSecureStorageKey,
} from './security';

describe('Security Utilities', () => {
  describe('isWebCryptoAvailable', () => {
    it('should check if Web Crypto API is available', () => {
      const available = isWebCryptoAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('secureRandomBytes', () => {
    it('should generate random bytes', () => {
      const bytes = secureRandomBytes(32);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(32);
    });

    it('should generate different random bytes each time', () => {
      const bytes1 = secureRandomBytes(32);
      const bytes2 = secureRandomBytes(32);
      expect(bytes1).not.toEqual(bytes2);
    });
  });

  describe('secureWipe', () => {
    it('should wipe Uint8Array', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      secureWipe(data);
      expect(data.every((b) => b === 0)).toBe(true);
    });

    it('should wipe number array', () => {
      const data = [1, 2, 3, 4, 5];
      secureWipe(data);
      expect(data.every((b) => b === 0)).toBe(true);
    });
  });

  describe('secureWipeString', () => {
    it('should return empty string', () => {
      const result = secureWipeString('test string');
      expect(result).toBe('');
    });
  });

  describe('createSecureStorageKey', () => {
    it('should create storage key from password', async () => {
      const { key, salt } = await createSecureStorageKey('test-password');
      expect(key).toBeInstanceOf(CryptoKey);
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(16);
    });

    it('should use provided salt', async () => {
      const salt = secureRandomBytes(16);
      const { key, salt: returnedSalt } = await createSecureStorageKey('password', salt);
      expect(returnedSalt).toEqual(salt);
      expect(key).toBeInstanceOf(CryptoKey);
    });
  });

  describe('deriveKeyFromPassword', () => {
    it('should derive key from password', async () => {
      const salt = secureRandomBytes(16);
      const key = await deriveKeyFromPassword('test-password', salt);
      expect(key).toBeInstanceOf(CryptoKey);
    });

    it('should derive different keys with different salts', async () => {
      const salt1 = secureRandomBytes(16);
      const salt2 = secureRandomBytes(16);
      const key1 = await deriveKeyFromPassword('password', salt1);
      const key2 = await deriveKeyFromPassword('password', salt2);
      expect(key1).not.toBe(key2);
    });
  });

  describe('encryptData and decryptData', () => {
    it('should encrypt and decrypt data', async () => {
      const password = 'test-password';
      const { key } = await createSecureStorageKey(password);
      const data = new TextEncoder().encode('secret data');

      const { encrypted, iv } = await encryptData(data, key);
      expect(encrypted).toBeInstanceOf(Uint8Array);
      expect(iv).toBeInstanceOf(Uint8Array);
      expect(encrypted).not.toEqual(data);

      const decrypted = await decryptData(encrypted, iv, key);
      expect(decrypted).toEqual(data);
    });

    it('should fail to decrypt with wrong key', async () => {
      const { key: key1 } = await createSecureStorageKey('password1');
      const { key: key2 } = await createSecureStorageKey('password2');
      const data = new TextEncoder().encode('secret');

      const { encrypted, iv } = await encryptData(data, key1);

      await expect(decryptData(encrypted, iv, key2)).rejects.toThrow();
    });

    it('should fail to decrypt with wrong IV', async () => {
      const { key } = await createSecureStorageKey('password');
      const data = new TextEncoder().encode('secret');
      const { encrypted, iv: _iv } = await encryptData(data, key);
      const wrongIv = secureRandomBytes(12);

      await expect(decryptData(encrypted, wrongIv, key)).rejects.toThrow();
    });
  });
});
