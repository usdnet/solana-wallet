# solana-wallet

A secure, self-custodial Solana wallet package for web applications. Create wallets, import from seed phrases or private keys, and sign transactions. The wallet only stores the public key and derivation path (metadata) - no sensitive data is stored in memory. Seed phrases and private keys must be provided for each signing operation.

## Installation

```bash
pnpm add @usdnet/solana-wallet
# or
npm install @usdnet/solana-wallet
# or
yarn add @usdnet/solana-wallet
```

## Quick Start

### Create Wallet with Mnemonic

```typescript
import { SolanaWallet } from '@usdnet/solana-wallet';

// Generate mnemonic and create wallet together
const { wallet, mnemonic } = SolanaWallet.createWithMnemonic();
console.log('Address:', wallet.getAddress());
console.log('Mnemonic:', mnemonic); // Save this securely!

// Or generate 24-word mnemonic
const { wallet: wallet24, mnemonic: mnemonic24 } = SolanaWallet.createWithMnemonic({ strength: 256 });
```

### Create Wallet with Private Key

```typescript
// Generate keypair and create wallet together
const { wallet, privateKey } = SolanaWallet.createWithPrivateKey();
console.log('Address:', wallet.getAddress());
console.log('Private Key:', privateKey); // Save this securely! (base58 encoded)

// The private key is returned but NOT stored in the wallet
// You can later recreate the wallet using:
const recreatedWallet = SolanaWallet.fromPrivateKey(privateKey);
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

### Validate Credentials

```typescript
// Validate if a seed phrase matches a wallet address
const isValid = SolanaWallet.validateSeedPhrase(
  walletAddress,
  'word1 word2 ... word12',
  "m/44'/501'/0'/0'" // Optional derivation path
);

// Validate if a private key matches a wallet address
const isValidKey = SolanaWallet.validatePrivateKey(
  walletAddress,
  'base58-or-base64-or-hex-string'
);
```

### Sign Transaction

```typescript
import { Transaction } from '@solana/web3.js';

const transaction = new Transaction();
transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
transaction.feePayer = wallet.getPublicKey();

// Sign with seed phrase
const signed = wallet.signTransaction(transaction, {
  seedPhrase: 'word1 word2 ... word12',
  derivationPath: "m/44'/501'/0'/0'" // Optional
});

// Or sign with private key
const signed2 = wallet.signTransaction(transaction, {
  privateKey: 'base58-or-base64-or-hex-string'
});
```

### Sign Message

```typescript
// Sign with seed phrase
const signature = wallet.signMessage('Hello, Solana!', {
  seedPhrase: 'word1 word2 ... word12'
});

// Or sign with private key
const signature2 = wallet.signMessage('Hello, Solana!', {
  privateKey: 'base58-or-base64-or-hex-string'
});

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

// Send 0.1 SOL with seed phrase
const signature = await wallet.sendSol(connection, recipient, 0.1, {
  seedPhrase: 'word1 word2 ... word12'
});

// Or send with private key
const signature2 = await wallet.sendSol(connection, recipient, 0.1, {
  privateKey: 'base58-or-base64-or-hex-string'
}, {
  skipPreflight: false, // Optional transaction options
  maxRetries: 3
});

console.log(`Transaction: ${signature}`);
```

### Send SPL Tokens

```typescript
import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const tokenMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
const recipient = new PublicKey('RecipientAddressHere');

// Send 100 tokens with seed phrase (amount is in human units; converted using decimals)
const signature = await wallet.sendToken(connection, tokenMint, recipient, 100, {
  seedPhrase: 'word1 word2 ... word12'
}, {
  decimals: 6, // Optional: auto-detected if not provided
  skipPreflight: false,
  maxRetries: 3
});

// Or send with private key
const signature2 = await wallet.sendToken(connection, tokenMint, recipient, 100, {
  privateKey: 'base58-or-base64-or-hex-string'
}, {
  decimals: 6
});

console.log(`Transaction: ${signature}`);
```

### Estimate Transaction Fees

```typescript
import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const recipient = new PublicKey('RecipientAddressHere');

// Estimate fee for sending SOL
const solFee = await wallet.estimateSendSolFee(connection, recipient, 0.1);
console.log(`Estimated fee: ${solFee} SOL`);

// Estimate fee for sending tokens
const tokenMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
const tokenFee = await wallet.estimateSendTokenFee(connection, tokenMint, recipient, 100, {
  decimals: 6 // Optional: auto-detected if not provided
});
console.log(`Estimated token transfer fee: ${tokenFee} SOL`);
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

### Listen to Balance Changes

```typescript
import { Connection } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');

// Listen to SOL balance changes
const unsubscribe = wallet.on('balanceChange', (event) => {
  console.log(`Balance changed from ${event.previousBalance} to ${event.newBalance}`);
  console.log(`Difference: ${event.difference > 0 ? '+' : ''}${event.difference} SOL`);
});

// Start monitoring balance using Solana Kit WebSocket subscriptions
await wallet.startBalanceMonitoring(connection);
// Optionally provide WebSocket URL: await wallet.startBalanceMonitoring(connection, 'wss://api.mainnet-beta.solana.com');

// Stop monitoring when done
wallet.stopBalanceMonitoring();

// Remove listener
unsubscribe();

// Listen to token balance changes
wallet.on('tokenBalanceChange', (event) => {
  console.log(`Token ${event.mint} balance changed`);
  console.log(`Previous: ${event.previousBalance?.uiAmount || 0}`);
  console.log(`New: ${event.newBalance?.uiAmount || 0}`);
  console.log(`Difference: ${event.difference}`);
});

// Start monitoring specific token balance
const tokenMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
await wallet.startTokenBalanceMonitoring(connection, tokenMint);

// Stop monitoring specific token
wallet.stopTokenBalanceMonitoring(tokenMint);

// Stop all token monitoring
wallet.stopAllTokenBalanceMonitoring();

// Balance change events are also emitted automatically when you send SOL or tokens
await wallet.sendSol(connection, recipient, 0.1, {
  seedPhrase: 'word1 word2 ... word12'
});
// This will automatically emit a 'balanceChange' event
```

## Security


**✅ Always:**
- Provide credentials only when needed for signing/sending
- Use HTTPS in production
- Validate credentials match wallet address before signing
- Never log or expose seed phrases or private keys

## API Reference

### SolanaWallet

**Static Methods:**
- `generateMnemonic(strength?)` - Generate mnemonic seed phrase (128 bits = 12 words, 256 bits = 24 words)
- `createWithMnemonic(options?)` - Generate mnemonic and create wallet together
- `createWithPrivateKey(options?)` - Generate keypair and create wallet together, returns private key (base58 encoded) but does NOT store it
- `create(options?)` - Create new wallet with random keypair
- `fromSeedPhrase(mnemonic, options?)` - Import from seed phrase
- `fromPrivateKey(privateKey)` - Import from private key (base58/base64/hex/Uint8Array)
- `validateSeedPhrase(address, mnemonic, derivationPath?)` - Validate if seed phrase matches wallet address
- `validatePrivateKey(address, privateKey)` - Validate if private key matches wallet address

**Instance Methods:**
- `getAddress()` - Get wallet address (string)
- `getPublicKey()` - Get PublicKey object
- `getDerivationPath()` - Get derivation path used for mnemonic-derived wallets
- `getBalance(connection)` - Get SOL balance (returns number in SOL)
- `getTokenBalance(connection, tokenMint)` - Get SPL token balance for specific token
- `getAllTokenBalances(connection)` - Get all SPL token balances
- `sendSol(connection, to, amount, credentials, options?)` - Send SOL to another address (requires SigningCredentials)
- `sendToken(connection, tokenMint, to, amount, credentials, options?)` - Send SPL tokens to another address (requires SigningCredentials, amount is in human units; converted using decimals)
- `estimateSendSolFee(connection, to, amount)` - Estimate transaction fee for sending SOL (returns fee in SOL)
- `estimateSendTokenFee(connection, tokenMint, to, amount, options?)` - Estimate transaction fee for sending SPL tokens (returns fee in SOL)
- `getTransactionActivity(connection, options?)` - Get transaction history
- `signTransaction(transaction, credentials)` - Sign transaction (requires SigningCredentials)
- `signMessage(message, credentials)` - Sign message (returns Uint8Array, requires SigningCredentials)
- `signMessageBase64(message, credentials)` / `signMessageBase58(message, credentials)` - Sign message in specific format (requires SigningCredentials)
- `verifyMessage(message, signature)` - Verify message signature
- `on(event, listener)` - Add event listener (returns unsubscribe function)
- `off(event, listener)` - Remove event listener
- `removeAllListeners(event?)` - Remove all listeners for an event type
- `startBalanceMonitoring(connection, wsUrl?)` - Start monitoring balance changes using Solana Kit WebSocket subscriptions
- `stopBalanceMonitoring()` - Stop monitoring balance changes
- `startTokenBalanceMonitoring(connection, tokenMint)` - Start monitoring token balance changes
- `stopTokenBalanceMonitoring(tokenMint)` - Stop monitoring specific token balance
- `stopAllTokenBalanceMonitoring()` - Stop all token balance monitoring
- `isBalanceMonitoringActive()` - Check if balance monitoring is active

### Interfaces

**SigningCredentials:**
```typescript
interface SigningCredentials {
  seedPhrase?: string;        // 12 or 24 word mnemonic phrase
  privateKey?: string | Uint8Array;  // Private key in base58/base64/hex or Uint8Array
  derivationPath?: string;    // Optional derivation path (only used with seedPhrase, default: "m/44'/501'/0'/0'")
}
```

**Usage:**
- Provide either `seedPhrase` OR `privateKey` (not both)
- `derivationPath` is only used when `seedPhrase` is provided
- Credentials are validated to match the wallet address before signing

**WalletWithMnemonic:**
```typescript
interface WalletWithMnemonic {
  wallet: SolanaWallet;
  mnemonic: string;
}
```

**WalletWithPrivateKey:**
```typescript
interface WalletWithPrivateKey {
  wallet: SolanaWallet;
  privateKey: string; // Base58 encoded private key
}
```

**Note:** The wallet instance only stores the public key and derivation path (metadata). No sensitive data (mnemonic, private key, or keypair) is stored in memory.

### Security Utilities

- `secureWipe(array)` - Securely wipe Uint8Array
- `isWebCryptoAvailable()` - Check Web Crypto API availability
- `secureRandomBytes(length)` - Generate secure random bytes
- `encryptData(data, key)` / `decryptData(encrypted, iv, key)` - Encrypt/decrypt data
- `createSecureStorageKey(password, salt?)` - Create storage key with PBKDF2

### Events

**Event Types:**
- `balanceChange` - Emitted when SOL balance changes
  - Event data: `{ previousBalance: number, newBalance: number, difference: number }`
- `tokenBalanceChange` - Emitted when SPL token balance changes
  - Event data: `{ mint: string, previousBalance: TokenBalance | null, newBalance: TokenBalance | null, difference: number }`

**Note:** 
- Balance change events are automatically emitted when you call `sendSol()` or `sendToken()`.
- `startBalanceMonitoring()` uses **Solana Kit** (`@solana/kit`) `accountNotifications` for real-time, event-driven WebSocket subscriptions (async generator + `AbortController`).
- `startTokenBalanceMonitoring()` monitors the token’s associated token account using `Connection.onAccountChange` (and falls back to an RPC fetch if parsing fails).
- WebSocket URL for `startBalanceMonitoring()` is automatically derived from `connection.rpcEndpoint`, or you can provide it explicitly.

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
