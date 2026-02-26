/**
 * Storage module
 */

import { EncryptedWalletData } from './wallet';
import { encryptData, decryptData, createSecureStorageKey } from './security';
import { uint8ArrayToBase64, base64ToUint8Array } from './utils';

// ============================================================================
// Interfaces
// ============================================================================

export interface StoredItem<T> {
  data: T;
  metadata: {
    createdAt: number;
    updatedAt: number;
  };
}

export interface EncryptedStorageOptions {
  password: string;
  encryptionKey?: CryptoKey;
  salt?: Uint8Array;
}

export interface StoredWallet {
  address: string;
  encryptedData: EncryptedWalletData;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// IndexedDB Storage
// ============================================================================

export class IndexedDBStorage {
  private db: IDBDatabase | null = null;
  private dbName: string;
  private storeName: string;
  private version: number;

  constructor(
    dbName: string = 'solana-wallet-db',
    storeName: string = 'data',
    version: number = 1
  ) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.version = version;
  }

  async init(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not available in this environment');
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () =>
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'key' });
          store.createIndex('createdAt', 'metadata.createdAt', { unique: false });
          store.createIndex('updatedAt', 'metadata.updatedAt', { unique: false });
        }
      };
    });
  }

  private ensureInitialized(): void {
    if (!this.db) throw new Error('IndexedDB not initialized. Call init() first.');
  }

  async get<T>(key: string): Promise<T | null> {
    this.ensureInitialized();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result ? (request.result.value as T) : null);
      request.onerror = () => reject(new Error(`Failed to get item: ${request.error?.message}`));
    });
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.ensureInitialized();
    const now = Date.now();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const getRequest = store.get(key);

      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        const item = {
          key,
          value,
          metadata: {
            createdAt: existing?.metadata.createdAt || now,
            updatedAt: now,
          },
        };
        const putRequest = store.put(item);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () =>
          reject(new Error(`Failed to set item: ${putRequest.error?.message}`));
      };
      getRequest.onerror = () => {
        const item = { key, value, metadata: { createdAt: now, updatedAt: now } };
        const putRequest = store.put(item);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () =>
          reject(new Error(`Failed to set item: ${putRequest.error?.message}`));
      };
    });
  }

  async delete(key: string): Promise<void> {
    this.ensureInitialized();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to delete item: ${request.error?.message}`));
    });
  }

  async getAllKeys(): Promise<string[]> {
    this.ensureInitialized();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(new Error(`Failed to get keys: ${request.error?.message}`));
    });
  }

  async has(key: string): Promise<boolean> {
    this.ensureInitialized();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result !== undefined);
      request.onerror = () => reject(new Error(`Failed to check item: ${request.error?.message}`));
    });
  }

  async clear(): Promise<void> {
    this.ensureInitialized();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to clear store: ${request.error?.message}`));
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Get raw item with metadata (for testing purposes)
   * @internal
   */
  async getRawItem(key: string): Promise<{ key: string; value: unknown; metadata: { createdAt: number; updatedAt: number } } | null> {
    this.ensureInitialized();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error(`Failed to get raw item: ${request.error?.message}`));
    });
  }
}

// ============================================================================
// Encrypted Storage
// ============================================================================

export class EncryptedStorage {
  private storage: IndexedDBStorage;
  private keyPrefix: string;
  private encryptionKey?: CryptoKey;
  private salt?: Uint8Array;

  constructor(storage: IndexedDBStorage, keyPrefix: string = '') {
    this.storage = storage;
    this.keyPrefix = keyPrefix;
  }

  async initEncryption(options: EncryptedStorageOptions): Promise<void> {
    if (options.encryptionKey && options.salt) {
      this.encryptionKey = options.encryptionKey;
      this.salt = options.salt;
    } else {
      const { key, salt } = await createSecureStorageKey(options.password, options.salt);
      this.encryptionKey = key;
      this.salt = salt;
    }
  }

  private ensureEncryption(): void {
    if (!this.encryptionKey) {
      throw new Error('Encryption not initialized. Call initEncryption() first.');
    }
  }

  private getFullKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}:${key}` : key;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.ensureEncryption();
    const dataBytes = new TextEncoder().encode(JSON.stringify(value));
    const { encrypted, iv } = await encryptData(dataBytes, this.encryptionKey!);
    const encryptedItem: StoredItem<{ encrypted: string; iv: string }> = {
      data: {
        encrypted: uint8ArrayToBase64(encrypted),
        iv: uint8ArrayToBase64(iv),
      },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };
    await this.storage.set(this.getFullKey(key), encryptedItem);
  }

  async get<T>(key: string): Promise<T | null> {
    this.ensureEncryption();
    const item = await this.storage.get<StoredItem<{ encrypted: string; iv: string }>>(
      this.getFullKey(key)
    );
    if (!item) return null;
    const encrypted = base64ToUint8Array(item.data.encrypted);
    const iv = base64ToUint8Array(item.data.iv);
    const decrypted = await decryptData(encrypted, iv, this.encryptionKey!);
    const json = new TextDecoder().decode(decrypted);
    return JSON.parse(json) as T;
  }

  async delete(key: string): Promise<void> {
    await this.storage.delete(this.getFullKey(key));
  }

  async has(key: string): Promise<boolean> {
    return this.storage.has(this.getFullKey(key));
  }

  async getAllKeys(): Promise<string[]> {
    const allKeys = await this.storage.getAllKeys();
    if (!this.keyPrefix) return allKeys;
    return allKeys
      .filter((key) => key.startsWith(this.keyPrefix + ':'))
      .map((key) => key.substring(this.keyPrefix.length + 1));
  }

  async clear(): Promise<void> {
    if (this.keyPrefix) {
      const keys = await this.getAllKeys();
      await Promise.all(keys.map((key) => this.delete(key)));
    } else {
      await this.storage.clear();
    }
  }

  close(): void {
    this.storage.close();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export async function createWalletStorage(
  password: string,
  options?: {
    dbName?: string;
    storeName?: string;
    keyPrefix?: string;
  }
): Promise<EncryptedStorage> {
  const storage = new IndexedDBStorage(
    options?.dbName || 'solana-wallet-db',
    options?.storeName || 'wallets'
  );
  await storage.init();
  const encryptedStorage = new EncryptedStorage(storage, options?.keyPrefix);
  await encryptedStorage.initEncryption({ password });
  return encryptedStorage;
}
