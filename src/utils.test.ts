/**
 * Tests for utility functions
 */

import { describe, it, expect } from 'vitest';
import { base64ToUint8Array, uint8ArrayToBase64, hexToUint8Array, uint8ArrayToHex } from './utils';

describe('Utils', () => {
  describe('base64ToUint8Array and uint8ArrayToBase64', () => {
    it('should convert base64 to Uint8Array and back', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 255]);
      const base64 = uint8ArrayToBase64(original);
      const converted = base64ToUint8Array(base64);
      expect(converted).toEqual(original);
    });

    it('should handle empty array', () => {
      const original = new Uint8Array([]);
      const base64 = uint8ArrayToBase64(original);
      const converted = base64ToUint8Array(base64);
      expect(converted).toEqual(original);
    });

    it('should handle large arrays', () => {
      const original = new Uint8Array(1000).fill(42);
      const base64 = uint8ArrayToBase64(original);
      const converted = base64ToUint8Array(base64);
      expect(converted).toEqual(original);
    });
  });

  describe('hexToUint8Array and uint8ArrayToHex', () => {
    it('should convert hex to Uint8Array and back', () => {
      const original = new Uint8Array([0x01, 0x02, 0xff, 0xab]);
      const hex = uint8ArrayToHex(original);
      const converted = hexToUint8Array(hex);
      expect(converted).toEqual(original);
    });

    it('should handle hex with 0x prefix', () => {
      const original = new Uint8Array([0x01, 0x02, 0xff]);
      const hex = uint8ArrayToHex(original);
      const withPrefix = '0x' + hex;
      const converted = hexToUint8Array(withPrefix);
      expect(converted).toEqual(original);
    });

    it('should handle empty array', () => {
      const original = new Uint8Array([]);
      const hex = uint8ArrayToHex(original);
      const converted = hexToUint8Array(hex);
      expect(converted).toEqual(original);
    });
  });
});
