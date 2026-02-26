/**
 * Utility functions for encoding/decoding that work in both Node.js and browser environments
 */

/**
 * Decode base64 string to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  // Browser environment
  if (typeof window !== 'undefined' && typeof atob !== 'undefined') {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  // Node.js environment
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }

  throw new Error('Neither atob nor Buffer is available');
}

/**
 * Encode Uint8Array to base64 string
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Browser environment
  if (typeof window !== 'undefined' && typeof btoa !== 'undefined') {
    const chunkSize = 8192;
    if (bytes.length <= chunkSize) {
      return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
    }

    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
  }

  // Node.js environment
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  throw new Error('Neither btoa nor Buffer is available');
}

/**
 * Decode hex string to Uint8Array
 */
export function hexToUint8Array(hex: string): Uint8Array {
  const hexString = hex.startsWith('0x') ? hex.slice(2) : hex;

  // Browser environment
  if (typeof window !== 'undefined') {
    const bytes = new Uint8Array(hexString.length / 2);
    for (let i = 0; i < hexString.length; i += 2) {
      bytes[i / 2] = parseInt(hexString.slice(i, i + 2), 16);
    }
    return bytes;
  }

  // Node.js environment
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(hexString, 'hex'));
  }

  throw new Error('Buffer is not available');
}

/**
 * Encode Uint8Array to hex string
 */
export function uint8ArrayToHex(bytes: Uint8Array): string {
  // Browser environment
  if (typeof window !== 'undefined') {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Node.js environment
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('hex');
  }

  throw new Error('Buffer is not available');
}
