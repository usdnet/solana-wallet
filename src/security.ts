/**
 * Security utilities for safe handling of sensitive data in web environments
 */

/**
 * Securely wipe sensitive data from memory by overwriting it
 */
export function secureWipe(data: Uint8Array | number[]): void {
  if (data instanceof Uint8Array) {
    crypto.getRandomValues(data);
    data.fill(0);
  } else if (Array.isArray(data)) {
    data.fill(0);
  }
}

/**
 * Securely wipe a string by converting to bytes, wiping, then returning empty string
 */
export function secureWipeString(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  secureWipe(bytes);
  return '';
}

/**
 * Check if Web Crypto API is available
 */
export function isWebCryptoAvailable(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof crypto.getRandomValues !== 'undefined'
  );
}

/**
 * Generate cryptographically secure random bytes
 */
export function secureRandomBytes(length: number): Uint8Array {
  if (!isWebCryptoAvailable()) {
    throw new Error('Web Crypto API is not available in this environment');
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Derive an encryption key from a password using PBKDF2
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  iterations: number = 100000
): Promise<CryptoKey> {
  if (!isWebCryptoAvailable()) {
    throw new Error('Web Crypto API is not available in this environment');
  }

  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data using AES-GCM
 */
export async function encryptData(
  data: Uint8Array,
  key: CryptoKey
): Promise<{ encrypted: Uint8Array; iv: Uint8Array }> {
  if (!isWebCryptoAvailable()) {
    throw new Error('Web Crypto API is not available in this environment');
  }

  const iv = secureRandomBytes(12);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv.buffer as ArrayBuffer,
    },
    key,
    data.buffer as ArrayBuffer
  );

  return {
    encrypted: new Uint8Array(encrypted),
    iv: iv,
  };
}

/**
 * Decrypt data using AES-GCM
 */
export async function decryptData(
  encrypted: Uint8Array,
  iv: Uint8Array,
  key: CryptoKey
): Promise<Uint8Array> {
  if (!isWebCryptoAvailable()) {
    throw new Error('Web Crypto API is not available in this environment');
  }

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv.buffer as ArrayBuffer,
    },
    key,
    encrypted.buffer as ArrayBuffer
  );

  return new Uint8Array(decrypted);
}

/**
 * Create a secure storage key for encrypting wallet data
 * This generates a key that can be used to encrypt/decrypt private keys
 */
export async function createSecureStorageKey(
  password: string,
  salt?: Uint8Array
): Promise<{ key: CryptoKey; salt: Uint8Array }> {
  if (!salt) {
    salt = secureRandomBytes(16);
  }
  const key = await deriveKeyFromPassword(password, salt);
  return { key, salt };
}
