# solana-wallet

A secure, self-custodial Solana wallet package with support for creating wallets, importing from seed phrases or private keys, and signing transactions and messages. Designed with security best practices for web applications.

## 🔒 Security Features

- **Secure Memory Management**: Automatic wiping of sensitive data after use
- **Encrypted Storage**: AES-GCM encryption for safe key storage
- **Web Crypto API**: Uses browser-native cryptographic functions
- **Secure Key Derivation**: PBKDF2 with configurable iterations
- **Memory Clearing**: Methods to securely wipe keys from memory

## ⚠️ Security Warnings

**IMPORTANT**: This package handles sensitive cryptographic material. Follow these security best practices:

1. **Never store private keys or seed phrases in:**
   - `localStorage`
   - `sessionStorage`
   - Cookies
   - URL parameters
   - Browser history
   - Console logs

2. **Always use encrypted storage** with user-provided passwords before persisting wallet data

3. **Clear sensitive data** from memory when done using the `clear()` method

4. **Never log or expose** private keys or seed phrases

5. **Use HTTPS** in production environments

## Installation

```bash
pnpm add solana-wallet
```

or

```bash
npm install solana-wallet
```

or

```bash
yarn add solana-wallet
```

## Usage

### Create a new wallet

```typescript
import { SolanaWallet } from 'solana-wallet';

// Create a new wallet with a random keypair
const wallet = SolanaWallet.create();
console.log('Address:', wallet.getAddress());

// Securely clear when done (recommended)
wallet.clear();
```

### Import from seed phrase

```typescript
import { SolanaWallet } from 'solana-wallet';

// Import wallet from a 12 or 24 word seed phrase
const mnemonic = 'word1 word2 word3 ... word12';
const wallet = SolanaWallet.fromSeedPhrase(mnemonic);
console.log('Address:', wallet.getAddress());

// Note: The mnemonic string may remain in memory.
// Consider clearing it if it was user input.
```

### Import from private key

```typescript
import { SolanaWallet } from 'solana-wallet';

// Import from private key (supports base58, base64, hex, or Uint8Array)
const privateKey = 'your-private-key-here'; // base58, base64, or hex string
const wallet = SolanaWallet.fromPrivateKey(privateKey);
console.log('Address:', wallet.getAddress());
```

### Encrypted Storage (Recommended for Web)

```typescript
import { SolanaWallet } from 'solana-wallet';

// Create or import wallet
const wallet = SolanaWallet.create();

// Encrypt wallet data with user password
const password = 'user-provided-strong-password';
const encryptedData = await wallet.encryptForStorage(password);

// Store encryptedData safely (e.g., in IndexedDB, but NOT localStorage)
// The encrypted data can be safely stored as it requires the password to decrypt

// Later, restore wallet from encrypted data
const restoredWallet = await SolanaWallet.fromEncrypted(encryptedData, password);

// Use the wallet
console.log('Address:', restoredWallet.getAddress());

// Clear when done
restoredWallet.clear();
```

### IndexedDB Storage (Recommended for Web Applications)

#### Simple Usage

```typescript
import { SolanaWallet, createWalletStorage, StoredWallet } from 'solana-wallet';

// Initialize storage with password
const storage = await createWalletStorage('user-password');

// Create or import wallet
const wallet = SolanaWallet.create();
const address = wallet.getAddress();

// Store wallet (automatically encrypted)
const encryptedData = await wallet.encryptForStorage('user-password');
const storedWallet: StoredWallet = {
  address,
  encryptedData,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
await storage.set(address, storedWallet);
console.log('Wallet stored:', address);

// Retrieve wallet later
const stored = await storage.get<StoredWallet>(address);
if (stored) {
  const restoredWallet = SolanaWallet.fromEncrypted(stored.encryptedData, 'user-password');
  console.log('Wallet restored:', restoredWallet.getAddress());
}

// Get all stored wallet addresses
const addresses = await storage.getAllKeys();
console.log('Stored wallets:', addresses);

// Get wallet metadata (without encrypted data)
const wallets = await Promise.all(
  addresses.map(async (addr) => {
    const stored = await storage.get<StoredWallet>(addr);
    if (stored) {
      const { encryptedData, ...metadata } = stored;
      return metadata;
    }
    return null;
  })
);
const walletList = wallets.filter((w) => w !== null);
walletList.forEach((w) => {
  console.log(`Address: ${w!.address}, Created: ${new Date(w!.createdAt)}`);
});

// Update wallet (e.g., after re-encryption)
const existing = await storage.get<StoredWallet>(address);
if (existing) {
  const newEncryptedData = await wallet.encryptForStorage('user-password');
  const updated: StoredWallet = {
    ...existing,
    encryptedData: newEncryptedData,
    updatedAt: Date.now(),
  };
  await storage.set(address, updated);
}

// Delete wallet
await storage.delete(address);

// Check if wallet exists
const exists = await storage.has(address);

// Clear all wallets (WARNING: destructive)
// await storage.clear();

// Close storage when done
storage.close();
```

#### Advanced: Custom Storage Options

```typescript
import { SolanaWallet, createWalletStorage } from 'solana-wallet';

// Use custom database and store names
const storage = await createWalletStorage('password', {
  dbName: 'my-db',
  storeName: 'my-store',
  keyPrefix: 'my-prefix', // Optional key prefix
});
```

#### Generic Encrypted Storage (for any data type)

```typescript
import {
  EncryptedStorage,
  IndexedDBStorage,
} from 'solana-wallet';

// Create encrypted storage for any data
const storage = new IndexedDBStorage('my-app-db', 'data');
await storage.init();

const encryptedStorage = new EncryptedStorage(storage, 'my-prefix');
await encryptedStorage.initEncryption({ password: 'user-password' });

// Store any encrypted data
await encryptedStorage.set('user-settings', { theme: 'dark', lang: 'en' });
await encryptedStorage.set('api-keys', { key1: 'value1', key2: 'value2' });

// Retrieve encrypted data
const settings = await encryptedStorage.get<{ theme: string; lang: string }>('user-settings');
const keys = await encryptedStorage.get<{ key1: string; key2: string }>('api-keys');

// List all keys
const allKeys = await encryptedStorage.getAllKeys();

// Delete data
await encryptedStorage.delete('api-keys');
```

### Sign transactions

```typescript
import { SolanaWallet, Transaction } from 'solana-wallet';
import { Connection } from '@solana/web3.js';

const wallet = SolanaWallet.create();
const connection = new Connection('https://api.mainnet-beta.solana.com');

// Create and sign a transaction
const transaction = new Transaction().add(
  // Your transaction instructions here
);
transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
transaction.feePayer = wallet.getPublicKey();

const signedTransaction = wallet.signTransaction(transaction);

// Send transaction...
```

### Sign messages

```typescript
import { SolanaWallet } from 'solana-wallet';

const wallet = SolanaWallet.create();

// Sign a message
const message = 'Hello, Solana!';
const signature = wallet.signMessage(message);
const signatureBase64 = wallet.signMessageBase64(message);
const signatureBase58 = wallet.signMessageBase58(message);

// Verify signature
const isValid = wallet.verifyMessage(message, signature);
console.log('Signature valid:', isValid);
```

### Secure Memory Management

```typescript
import { SolanaWallet, secureWipe } from 'solana-wallet';

const wallet = SolanaWallet.create();

// Use the wallet...
const address = wallet.getAddress();

// When done, securely clear the wallet
wallet.clear();

// After clear(), the wallet cannot be used
// wallet.signTransaction(...) // Will throw an error
```

### Advanced: Custom Secure Storage

```typescript
import { SolanaWallet, createSecureStorageKey, encryptData, decryptData } from 'solana-wallet';

const wallet = SolanaWallet.create();

// Create a storage key from user password
const password = 'user-password';
const { key, salt } = await createSecureStorageKey(password);

// Encrypt the private key
const privateKey = wallet.getPrivateKey();
const { encrypted, iv } = await encryptData(privateKey, key);

// Store encrypted, iv, and salt (but NOT the password or key)
// Later, restore:
const restoredKey = await createSecureStorageKey(password, salt);
const decrypted = await decryptData(encrypted, iv, restoredKey.key);
const restoredWallet = SolanaWallet.fromPrivateKey(decrypted);

// Securely wipe sensitive data
secureWipe(privateKey);
secureWipe(decrypted);
```

## Security Best Practices for Web Applications

### Critical Security Rules

**⚠️ NEVER store keys in plain text:**

```typescript
// ❌ NEVER DO THIS:
localStorage.setItem('privateKey', wallet.getPrivateKeyBase58());
localStorage.setItem('mnemonic', userMnemonic);
document.cookie = `key=${wallet.getPrivateKeyBase58()}`;
console.log('Private key:', wallet.getPrivateKeyBase58());

// ✅ ALWAYS DO THIS:
import { StoredWallet } from 'solana-wallet';
const encrypted = await wallet.encryptForStorage(userPassword);
const storedWallet: StoredWallet = {
  address: wallet.getAddress(),
  encryptedData: encrypted,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
await storage.set(wallet.getAddress(), storedWallet);
```

### 1. Use IndexedDB with Encryption

Always use IndexedDB with encrypted storage:

```typescript
// ✅ GOOD: Use IndexedDB storage (automatically encrypts)
import { createWalletStorage, StoredWallet } from 'solana-wallet';
const storage = await createWalletStorage('user-password');
const encryptedData = await wallet.encryptForStorage('user-password');
const storedWallet: StoredWallet = {
  address: wallet.getAddress(),
  encryptedData,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};
await storage.set(wallet.getAddress(), storedWallet);

// ✅ GOOD: Manual encrypted storage
const encrypted = await wallet.encryptForStorage(userPassword);
await storeInIndexedDB(encrypted);

// ❌ BAD: Never store raw keys
await localStorage.setItem('key', wallet.getPrivateKeyBase58()); // NEVER DO THIS
```

**Storage Recommendations:**
- ✅ **Recommended**: IndexedDB with encryption (most secure)
- ❌ **Never**: localStorage, sessionStorage, cookies, or URL parameters

### 2. Password Security

- Use strong, user-provided passwords
- Never store passwords alongside encrypted data
- Consider using password managers
- Implement password strength requirements
- Use PBKDF2 with high iteration counts (default: 100,000)

### 3. Clear Sensitive Data

Clear wallets and temporary data when done:

```typescript
// After using a wallet
wallet.clear();

// After processing user input
const mnemonic = getUserInput();
const wallet = SolanaWallet.fromSeedPhrase(mnemonic);
// Use wallet...
wallet.clear();
// Note: The mnemonic string may still be in memory due to JS string immutability
```

### 4. Transport Security

- Always use HTTPS in production
- Never send private keys or seed phrases over unencrypted connections
- Use secure WebSocket connections (WSS) if needed

### 5. Input Validation

Validate and sanitize all user inputs:

```typescript
// Validate mnemonic
if (!bip39.validateMnemonic(userInput)) {
  throw new Error('Invalid mnemonic phrase');
}

// Validate private key format before use
try {
  const wallet = SolanaWallet.fromPrivateKey(userInput);
} catch (error) {
  // Handle error without exposing the input
  showGenericError('Invalid key format');
}
```

### 6. Handle Errors Securely

Don't expose sensitive information in error messages:

```typescript
try {
  const wallet = SolanaWallet.fromPrivateKey(key);
} catch (error) {
  // ❌ BAD: Don't log the key
  console.error('Failed to import key:', key);
  
  // ✅ GOOD: Generic error message
  console.error('Failed to import wallet: Invalid key format');
}
```

### 7. Use Secure Random Generation

The package uses `crypto.getRandomValues()` for secure random number generation automatically.

### 8. Additional Security Considerations

**Content Security Policy (CSP):**
Implement strict CSP headers to prevent XSS attacks:
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'
```

**Subresource Integrity (SRI):**
If loading from CDN, use SRI to ensure integrity:
```html
<script src="..." integrity="sha384-..." crossorigin="anonymous"></script>
```

**Regular Security Audits:**
- Regularly update dependencies
- Audit your code for security vulnerabilities
- Use tools like `npm audit` and security scanners
- Keep the `solana-wallet` package updated

### 9. What NOT to Store

**Never store private keys or seed phrases in:**
- `localStorage` (accessible to all scripts on same origin)
- `sessionStorage` (same as localStorage)
- Cookies (sent with every request, logged in server logs)
- URL parameters (exposed in browser history, server logs)
- Browser history
- Console logs
- Error messages
- Server logs

### 10. Best Practices Summary

1. ✅ **Encrypt before storage** - Always use `encryptForStorage()` or `EncryptedStorage`
2. ✅ **Use strong passwords** - User-provided, never stored
3. ✅ **Clear memory** - Call `clear()` when done
4. ✅ **Use HTTPS** - Always in production
5. ✅ **Validate inputs** - Check mnemonic and key formats
6. ✅ **Handle errors securely** - Don't expose sensitive data
7. ✅ **Use IndexedDB** - Better than localStorage for encrypted data
8. ❌ **Never log keys** - Don't expose in console or logs
9. ❌ **Never store plain text** - Always encrypt
10. ❌ **Never send over HTTP** - Use HTTPS only

## ⚠️ Security Disclaimer

This package provides tools for secure key management, but **you are responsible for implementing secure storage and handling in your application**. The authors are not responsible for any loss of funds or data due to improper use of this package.

## API Reference

### SolanaWallet

#### Static Methods

- `create(options?)` - Create a new wallet
- `fromSeedPhrase(mnemonic, options?)` - Import from seed phrase
- `fromPrivateKey(privateKey)` - Import from private key
- `fromEncrypted(encryptedData, password)` - Import from encrypted data

#### Instance Methods

- `getAddress()` - Get wallet address as string
- `getPublicKey()` - Get PublicKey object
- `getPrivateKey()` - Get private key as Uint8Array (⚠️ use with caution)
- `getPrivateKeyBase58()` - Get private key as base58 (⚠️ use with caution)
- `getPrivateKeyBase64()` - Get private key as base64 (⚠️ use with caution)
- `getPrivateKeyHex()` - Get private key as hex (⚠️ use with caution)
- `signTransaction(transaction)` - Sign a transaction
- `signMessage(message)` - Sign a message
- `signMessageBase64(message)` - Sign message, return base64
- `signMessageBase58(message)` - Sign message, return base58
- `verifyMessage(message, signature)` - Verify message signature
- `encryptForStorage(password)` - Encrypt wallet for storage
- `clear()` - Securely clear wallet from memory
- `isCleared()` - Check if wallet is cleared

### Storage

#### Factory Functions

- `createWalletStorage(password, options?)` - Create wallet storage with IndexedDB
  - `options.dbName?` - Custom database name (default: 'solana-wallet-db')
  - `options.storeName?` - Custom store name (default: 'wallets')
  - `options.keyPrefix?` - Optional key prefix for namespacing

#### Classes

- `EncryptedStorage` - Generic encrypted storage for any data type (returned by `createWalletStorage`)
  - `set(key, value)` - Store encrypted data
  - `get<T>(key)` - Retrieve and decrypt data
  - `delete(key)` - Delete data
  - `has(key)` - Check if key exists
  - `getAllKeys()` - Get all keys
  - `clear()` - Clear all data
  - `close()` - Close storage connection

- `IndexedDBStorage` - IndexedDB storage implementation
  - `init()` - Initialize IndexedDB connection
  - `get<T>(key)` - Get value by key
  - `set<T>(key, value)` - Set value by key
  - `delete(key)` - Delete value by key
  - `has(key)` - Check if key exists
  - `getAllKeys()` - Get all keys
  - `clear()` - Clear all data
  - `close()` - Close database connection

### Security Utilities

- `secureWipe(array)` - Securely wipe Uint8Array from memory
- `secureWipeString(str)` - Attempt to wipe string (limited effectiveness)
- `isWebCryptoAvailable()` - Check if Web Crypto API is available
- `secureRandomBytes(length)` - Generate secure random bytes
- `deriveKeyFromPassword(password, salt?)` - Derive encryption key from password
- `encryptData(data, key)` - Encrypt data with AES-GCM
- `decryptData(encrypted, iv, key)` - Decrypt data with AES-GCM
- `createSecureStorageKey(password, salt?)` - Create storage key with PBKDF2

## Development

```bash
# Install dependencies
pnpm install

# Build the package
pnpm run build

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Clean build artifacts
pnpm run clean
```

## Testing

The package includes comprehensive tests for all functionality:

- **Wallet operations**: Create, import, sign, encrypt
- **Security utilities**: Encryption, decryption, key derivation
- **Storage**: IndexedDB storage with encryption
- **Utility functions**: Encoding/decoding operations

Run tests with:
```bash
pnpm test
```

## License

MIT
