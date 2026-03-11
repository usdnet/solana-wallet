/**
 * Tests for storage module
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBStorage, EncryptedStorage, createWalletStorage, StoredWallet } from './storage';
import { SolanaWallet } from './wallet';

describe('IndexedDBStorage', () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    storage = new IndexedDBStorage('test-db', 'test-store');
    await storage.init();
  });

  afterEach(async () => {
    try {
      await storage.clear();
    } catch {
      // Ignore errors
    }
    storage.close();
  });

  it('should store and retrieve data', async () => {
    await storage.set('test-key', { value: 'test-data' });
    const result = await storage.get('test-key');
    expect(result).toEqual({ value: 'test-data' });
  });

  it('should preserve createdAt on update', async () => {
    await storage.set('test-key', { value: 'data1' });

    const firstItem = await storage.getRawItem('test-key');
    const firstCreatedAt = firstItem?.metadata.createdAt;
    expect(firstCreatedAt).toBeDefined();
    if (!firstCreatedAt) throw new Error('firstCreatedAt should be defined');

    await new Promise((resolve) => setTimeout(resolve, 10));
    await storage.set('test-key', { value: 'data2' });

    const secondItem = await storage.getRawItem('test-key');
    expect(secondItem?.metadata.createdAt).toBe(firstCreatedAt);
    expect(secondItem?.metadata.updatedAt).toBeGreaterThan(firstCreatedAt);
  });

  it('should return null for non-existent key', async () => {
    const result = await storage.get('non-existent');
    expect(result).toBeNull();
  });

  it('should delete data', async () => {
    await storage.set('test-key', 'data');
    await storage.delete('test-key');
    const result = await storage.get('test-key');
    expect(result).toBeNull();
  });

  it('should get all keys', async () => {
    await storage.set('key1', 'data1');
    await storage.set('key2', 'data2');
    const keys = await storage.getAllKeys();
    expect(keys).toContain('key1');
    expect(keys).toContain('key2');
  });

  it('should check if key exists', async () => {
    await storage.set('test-key', 'data');
    expect(await storage.has('test-key')).toBe(true);
    expect(await storage.has('non-existent')).toBe(false);
  });

  it('should clear all data', async () => {
    await storage.set('key1', 'data1');
    await storage.set('key2', 'data2');
    await storage.clear();
    const keys = await storage.getAllKeys();
    expect(keys.length).toBe(0);
  });
});

describe('EncryptedStorage', () => {
  let storage: IndexedDBStorage;
  let encryptedStorage: EncryptedStorage;

  beforeEach(async () => {
    storage = new IndexedDBStorage('test-encrypted-db', 'test-encrypted-store');
    await storage.init();
    encryptedStorage = new EncryptedStorage(storage);
    await encryptedStorage.initEncryption({ password: 'test-password' });
  });

  afterEach(() => {
    encryptedStorage.close();
  });

  it('should encrypt and store data', async () => {
    await encryptedStorage.set('test-key', { secret: 'data' });
    const result = await encryptedStorage.get<{ secret: string }>('test-key');
    expect(result).toEqual({ secret: 'data' });
  });

  it('should return null for non-existent key', async () => {
    const result = await encryptedStorage.get('non-existent');
    expect(result).toBeNull();
  });

  it('should handle different data types', async () => {
    await encryptedStorage.set('string', 'test');
    await encryptedStorage.set('number', 42);
    await encryptedStorage.set('object', { key: 'value' });
    await encryptedStorage.set('array', [1, 2, 3]);

    expect(await encryptedStorage.get<string>('string')).toBe('test');
    expect(await encryptedStorage.get<number>('number')).toBe(42);
    expect(await encryptedStorage.get<{ key: string }>('object')).toEqual({ key: 'value' });
    expect(await encryptedStorage.get<number[]>('array')).toEqual([1, 2, 3]);
  });

  it('should use key prefix', async () => {
    const prefixedStorage = new EncryptedStorage(storage, 'prefix');
    await prefixedStorage.initEncryption({ password: 'password' });
    await prefixedStorage.set('key', 'value');
    const keys = await prefixedStorage.getAllKeys();
    expect(keys).toContain('key');
  });
});

describe('Wallet Storage with EncryptedStorage', () => {
  let storage: EncryptedStorage;
  let indexedDBStorage: IndexedDBStorage;

  beforeEach(async () => {
    indexedDBStorage = new IndexedDBStorage('test-wallet-storage-db', 'test-wallet-storage-store');
    await indexedDBStorage.init();
    storage = new EncryptedStorage(indexedDBStorage);
    await storage.initEncryption({ password: 'test-password' });
  });

  afterEach(async () => {
    try {
      await storage.clear();
    } catch {
      // Ignore errors
    }
    storage.close();
    indexedDBStorage.close();
  });

  it('should store and retrieve wallet metadata', async () => {
    const wallet = SolanaWallet.create();
    const address = wallet.getAddress();
    const storedWallet: StoredWallet = {
      address,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await storage.set(address, storedWallet);
    const stored = await storage.get<StoredWallet>(address);
    expect(stored).not.toBeNull();
    expect(stored!.address).toBe(address);
  });

  it('should get all addresses', async () => {
    const wallet1 = SolanaWallet.create();
    const wallet2 = SolanaWallet.create();

    await storage.set(wallet1.getAddress(), {
      address: wallet1.getAddress(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await storage.set(wallet2.getAddress(), {
      address: wallet2.getAddress(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const addresses = await storage.getAllKeys();
    expect(addresses).toContain(wallet1.getAddress());
    expect(addresses).toContain(wallet2.getAddress());
  });

  it('should get wallet metadata', async () => {
    const wallet = SolanaWallet.create();
    await storage.set(wallet.getAddress(), {
      address: wallet.getAddress(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const addresses = await storage.getAllKeys();
    const wallets = await Promise.all(
      addresses.map(async (address) => {
        const stored = await storage.get<StoredWallet>(address);
        return stored;
      })
    );
    const filteredWallets = wallets.filter((w) => w !== null);
    expect(filteredWallets.length).toBe(1);
    expect(filteredWallets[0]!.address).toBe(wallet.getAddress());
  });

  it('should update wallet', async () => {
    const wallet = SolanaWallet.create();
    const address = wallet.getAddress();
    await storage.set(address, {
      address,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const existing = await storage.get<StoredWallet>(address);
    const updated: StoredWallet = {
      ...existing!,
      updatedAt: Date.now(),
    };
    await storage.set(address, updated);
    const stored = await storage.get<StoredWallet>(address);
    expect(stored!.address).toBe(wallet.getAddress());
    expect(stored!.updatedAt).toBeGreaterThan(existing!.updatedAt);
  });

  it('should delete wallet', async () => {
    const wallet = SolanaWallet.create();
    await storage.set(wallet.getAddress(), {
      address: wallet.getAddress(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await storage.delete(wallet.getAddress());

    expect(await storage.has(wallet.getAddress())).toBe(false);
  });

  it('should check if wallet exists', async () => {
    const wallet = SolanaWallet.create();
    expect(await storage.has(wallet.getAddress())).toBe(false);

    await storage.set(wallet.getAddress(), {
      address: wallet.getAddress(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(await storage.has(wallet.getAddress())).toBe(true);
  });
});

describe('Factory Functions', () => {
  it('should create wallet storage', async () => {
    const storage = await createWalletStorage('password', {
      dbName: 'test-factory-db',
      storeName: 'test-factory-store',
    });

    expect(storage).toBeInstanceOf(EncryptedStorage);

    const wallet = SolanaWallet.create();
    await storage.set(wallet.getAddress(), {
      address: wallet.getAddress(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const stored = await storage.get<StoredWallet>(wallet.getAddress());
    expect(stored!.address).toBe(wallet.getAddress());

    storage.close();
  });

  it('should create wallet storage with custom options', async () => {
    const storage = await createWalletStorage('password', {
      dbName: 'test-custom-db',
      storeName: 'test-custom-store',
      keyPrefix: 'test-prefix',
    });

    expect(storage).toBeInstanceOf(EncryptedStorage);

    const wallet = SolanaWallet.create();
    await storage.set(wallet.getAddress(), {
      address: wallet.getAddress(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const stored = await storage.get<StoredWallet>(wallet.getAddress());
    expect(stored!.address).toBe(wallet.getAddress());

    storage.close();
  });
});
