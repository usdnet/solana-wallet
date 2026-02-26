# solana-wallet

A secure, self-custodial Solana wallet package for web applications. Create wallets, import from seed phrases or private keys, sign transactions, and securely store encrypted keys.

## Installation

```bash
pnpm add solana-wallet
# or
npm install solana-wallet
# or
yarn add solana-wallet
```

## Quick Start

### Create Wallet

```typescript
import { SolanaWallet } from 'solana-wallet';

const wallet = SolanaWallet.create();
console.log('Address:', wallet.getAddress());
```

### Import from Seed Phrase

```typescript
const wallet = SolanaWallet.fromSeedPhrase('word1 word2 ... word12');
```

### Import from Private Key

```typescript
const wallet = SolanaWallet.fromPrivateKey('base58-or-base64-or-hex-string');
```

### Store Encrypted Wallet

```typescript
import { SolanaWallet, createWalletStorage, StoredWallet } from 'solana-wallet';

// Initialize storage
const storage = await createWalletStorage('user-password');

// Create and store wallet
const wallet = SolanaWallet.create();
const encryptedData = await wallet.encryptForStorage('user-password');
const storedWallet: StoredWallet = {
  address: wallet.getAddress(),
  encryptedData,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
await storage.set(wallet.getAddress(), storedWallet);

// Retrieve wallet
const stored = await storage.get<StoredWallet>(wallet.getAddress());
if (stored) {
  const restored = await SolanaWallet.fromEncrypted(stored.encryptedData, 'user-password');
}
```

### Sign Transaction

```typescript
import { Transaction } from '@solana/web3.js';

const transaction = new Transaction();
transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
transaction.feePayer = wallet.getPublicKey();

const signed = wallet.signTransaction(transaction);
```

### Sign Message

```typescript
const signature = wallet.signMessage('Hello, Solana!');
const isValid = wallet.verifyMessage('Hello, Solana!', signature);
```

## Security

**⚠️ Never store private keys or seed phrases in:**
- `localStorage` / `sessionStorage`
- Cookies
- URL parameters
- Console logs

**✅ Always:**
- Use encrypted storage (`encryptForStorage()` or `createWalletStorage()`)
- Use strong user-provided passwords
- Clear wallets when done: `wallet.clear()`
- Use HTTPS in production

## API Reference

### SolanaWallet

**Static Methods:**
- `create(options?)` - Create new wallet
- `fromSeedPhrase(mnemonic, options?)` - Import from seed phrase
- `fromPrivateKey(privateKey)` - Import from private key (base58/base64/hex/Uint8Array)
- `fromEncrypted(encryptedData, password)` - Import from encrypted data

**Instance Methods:**
- `getAddress()` - Get wallet address (string)
- `getPublicKey()` - Get PublicKey object
- `getPrivateKey()` - Get private key as Uint8Array
- `getPrivateKeyBase58()` / `getPrivateKeyBase64()` / `getPrivateKeyHex()` - Get private key in various formats
- `signTransaction(transaction)` - Sign transaction
- `signMessage(message)` - Sign message (returns Uint8Array)
- `signMessageBase64(message)` / `signMessageBase58(message)` - Sign message in specific format
- `verifyMessage(message, signature)` - Verify message signature
- `encryptForStorage(password)` - Encrypt wallet for storage
- `clear()` - Securely clear wallet from memory
- `isCleared()` - Check if wallet is cleared

### Storage

**Factory:**
- `createWalletStorage(password, options?)` - Create encrypted storage
  - `options.dbName?` - Database name (default: 'solana-wallet-db')
  - `options.storeName?` - Store name (default: 'wallets')
  - `options.keyPrefix?` - Optional key prefix

**EncryptedStorage** (returned by `createWalletStorage`):
- `set(key, value)` - Store encrypted data
- `get<T>(key)` - Retrieve and decrypt data
- `delete(key)` - Delete data
- `has(key)` - Check if key exists
- `getAllKeys()` - Get all keys
- `clear()` - Clear all data
- `close()` - Close storage connection

**IndexedDBStorage:**
- `init()` - Initialize IndexedDB
- `get<T>(key)` / `set<T>(key, value)` / `delete(key)` / `has(key)` / `getAllKeys()` / `clear()` / `close()`

### Security Utilities

- `secureWipe(array)` - Securely wipe Uint8Array
- `isWebCryptoAvailable()` - Check Web Crypto API availability
- `secureRandomBytes(length)` - Generate secure random bytes
- `encryptData(data, key)` / `decryptData(encrypted, iv, key)` - Encrypt/decrypt data
- `createSecureStorageKey(password, salt?)` - Create storage key with PBKDF2

## Development

```bash
pnpm install
pnpm run build
pnpm test
pnpm lint
pnpm format
```

## License

MIT
