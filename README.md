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

### Create Wallet with Mnemonic

```typescript
import { SolanaWallet } from 'solana-wallet';

// Generate mnemonic and create wallet together
const { wallet, mnemonic } = SolanaWallet.createWithMnemonic();
console.log('Address:', wallet.getAddress());
console.log('Mnemonic:', mnemonic); // Save this securely!

// Or generate 24-word mnemonic
const { wallet: wallet24, mnemonic: mnemonic24 } = SolanaWallet.createWithMnemonic({ strength: 256 });
```

### Generate Mnemonic Only

```typescript
// Generate 12-word mnemonic (default)
const mnemonic = SolanaWallet.generateMnemonic();

// Generate 24-word mnemonic
const mnemonic24 = SolanaWallet.generateMnemonic(256);
```

### Create Wallet (Random Keypair)

```typescript
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

### Get Balance

```typescript
import { Connection } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');

// Get SOL balance
const solBalance = await wallet.getBalance(connection);
console.log(`Balance: ${solBalance} SOL`);

// Get SPL token balance
const tokenMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
const tokenBalance = await wallet.getTokenBalance(connection, tokenMint);
if (tokenBalance) {
  console.log(`Token Balance: ${tokenBalance.uiAmount} (${tokenBalance.amount} raw)`);
}

// Get all SPL token balances
const allTokens = await wallet.getAllTokenBalances(connection);
console.log(`Found ${allTokens.length} token accounts`);
```

### Send SOL

```typescript
import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const recipient = new PublicKey('RecipientAddressHere');

// Send 0.1 SOL
const signature = await wallet.sendSol(connection, recipient, 0.1);
console.log(`Transaction: ${signature}`);
```

### Send SPL Tokens

```typescript
import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const tokenMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
const recipient = new PublicKey('RecipientAddressHere');

// Send 100 tokens (with 6 decimals)
const signature = await wallet.sendToken(connection, tokenMint, recipient, 100, {
  decimals: 6, // Optional: auto-detected if not provided
});
console.log(`Transaction: ${signature}`);
```

### Get Transaction Activity

```typescript
import { Connection } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');

// Get recent transactions
const activities = await wallet.getTransactionActivity(connection, {
  limit: 20, // Optional: default 20
});

for (const activity of activities) {
  console.log(`${activity.type}: ${activity.amount || 'N/A'} ${activity.tokenMint || 'SOL'}`);
  console.log(`Signature: ${activity.signature}`);
  console.log(`Time: ${activity.blockTime ? new Date(activity.blockTime * 1000) : 'N/A'}`);
}
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
- `generateMnemonic(strength?)` - Generate mnemonic seed phrase (128 bits = 12 words, 256 bits = 24 words)
- `createWithMnemonic(options?)` - Generate mnemonic and create wallet together
- `create(options?)` - Create new wallet with random keypair
- `fromSeedPhrase(mnemonic, options?)` - Import from seed phrase
- `fromPrivateKey(privateKey)` - Import from private key (base58/base64/hex/Uint8Array)
- `fromEncrypted(encryptedData, password)` - Import from encrypted data

**Instance Methods:**
- `getAddress()` - Get wallet address (string)
- `getPublicKey()` - Get PublicKey object
- `getPrivateKey()` - Get private key as Uint8Array
- `getPrivateKeyBase58()` / `getPrivateKeyBase64()` / `getPrivateKeyHex()` - Get private key in various formats
- `getBalance(connection)` - Get SOL balance (returns number in SOL)
- `getTokenBalance(connection, tokenMint)` - Get SPL token balance for specific token
- `getAllTokenBalances(connection)` - Get all SPL token balances
- `sendSol(connection, to, amount, options?)` - Send SOL to another address
- `sendToken(connection, tokenMint, to, amount, options?)` - Send SPL tokens to another address
- `getTransactionActivity(connection, options?)` - Get transaction history
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
