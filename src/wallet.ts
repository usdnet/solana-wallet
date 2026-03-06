/**
 * Solana self-custodial wallet functionality
 */

import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  Connection,
  LAMPORTS_PER_SOL,
  SystemProgram,
  sendAndConfirmTransaction,
  ParsedTransactionWithMeta,
  ConfirmedSignatureInfo,
} from '@solana/web3.js';
import { address, createSolanaRpcSubscriptions } from '@solana/kit';
import { getAccount, getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import * as nacl from 'tweetnacl';
import * as bs58 from 'bs58';
import {
  secureWipe,
  encryptData,
  decryptData,
  createSecureStorageKey,
  isWebCryptoAvailable,
} from './security';
import { base64ToUint8Array, uint8ArrayToBase64, hexToUint8Array, uint8ArrayToHex } from './utils';

export interface WalletOptions {
  derivationPath?: string;
}

export interface WalletWithMnemonic {
  wallet: SolanaWallet;
  mnemonic: string;
}

export interface EncryptedWalletData {
  encrypted: string;
  iv: string;
  salt: string;
  derivationPath?: string;
}

export interface TokenBalance {
  mint: string;
  amount: string;
  decimals: number;
  uiAmount: number;
}

export interface TransactionActivity {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: ConfirmedSignatureInfo['err'];
  memo?: string;
  type: 'send' | 'receive' | 'other';
  amount?: number;
  tokenMint?: string;
}

export interface BalanceChangeEvent {
  previousBalance: number;
  newBalance: number;
  difference: number;
}

export interface TokenBalanceChangeEvent {
  mint: string;
  previousBalance: TokenBalance | null;
  newBalance: TokenBalance | null;
  difference: number;
}

export type WalletEventType = 'balanceChange' | 'tokenBalanceChange';

export type WalletEventListener<T = unknown> = (data: T) => void;

/**
 * Self-custodial Solana wallet class
 */
export class SolanaWallet {
  private keypair: Keypair;
  private derivationPath: string;
  private _isCleared: boolean = false;
  private eventListeners: Map<
    WalletEventType,
    Set<(data: BalanceChangeEvent | TokenBalanceChangeEvent) => void>
  > = new Map();
  private balanceMonitorAbortController: AbortController | null = null;
  private balanceMonitorConnection: Connection | null = null;
  private tokenBalanceSubscriptions: Map<string, { abortController: AbortController; connection: Connection }> = new Map();
  private lastKnownBalance: number | null = null;
  private lastKnownTokenBalances: Map<string, TokenBalance | null> = new Map();

  private constructor(keypair: Keypair, derivationPath: string = "m/44'/501'/0'/0'") {
    this.keypair = keypair;
    this.derivationPath = derivationPath;
  }

  /**
   * Generate a new mnemonic seed phrase
   * @param strength - Entropy strength in bits (128 for 12 words, 256 for 24 words). Default: 128
   */
  static generateMnemonic(strength: number = 128): string {
    return bip39.generateMnemonic(strength);
  }

  /**
   * Create a new wallet with a random keypair
   */
  static create(options: WalletOptions = {}): SolanaWallet {
    const keypair = Keypair.generate();
    return new SolanaWallet(keypair, options.derivationPath);
  }

  /**
   * Generate a mnemonic and create a wallet from it
   * @param options - Wallet options including derivation path and mnemonic strength
   * @returns Object containing both the wallet and the mnemonic phrase
   */
  static createWithMnemonic(options: WalletOptions & { strength?: number } = {}): WalletWithMnemonic {
    const strength = options.strength ?? 128;
    const mnemonic = SolanaWallet.generateMnemonic(strength);
    const wallet = SolanaWallet.fromSeedPhrase(mnemonic, {
      derivationPath: options.derivationPath,
    });
    return { wallet, mnemonic };
  }

  /**
   * Import wallet from a seed phrase (mnemonic)
   * @param mnemonic - 12 or 24 word seed phrase
   * @param options - Wallet options including derivation path
   */
  static fromSeedPhrase(mnemonic: string, options: WalletOptions = {}): SolanaWallet {
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase');
    }

    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const derivationPath = options.derivationPath || "m/44'/501'/0'/0'";
    const derivedSeed = derivePath(derivationPath, seed.toString('hex')).key;
    const keypair = Keypair.fromSeed(derivedSeed);

    secureWipe(seed);
    secureWipe(derivedSeed);

    return new SolanaWallet(keypair, derivationPath);
  }

  /**
   * Import wallet from a private key
   * @param privateKey - Private key as Uint8Array (32 or 64 bytes) or string (base64/hex/base58)
   */
  static fromPrivateKey(privateKey: Uint8Array | string): SolanaWallet {
    let secretKey: Uint8Array;
    let tempBuffer: Uint8Array | null = null;

    if (typeof privateKey === 'string') {
      try {
        const decoded = bs58.decode(privateKey);
        if (decoded.length === 64 || decoded.length === 32) {
          secretKey = decoded;
          tempBuffer = decoded;
        } else {
          throw new Error('Invalid base58 key length');
        }
      } catch {
        try {
          const decoded = base64ToUint8Array(privateKey);
          if (decoded.length === 64 || decoded.length === 32) {
            secretKey = decoded;
            tempBuffer = secretKey;
          } else {
            throw new Error('Invalid base64 key length');
          }
        } catch {
          try {
            const hexString = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
            const decoded = hexToUint8Array(hexString);
            if (decoded.length === 64 || decoded.length === 32) {
              secretKey = decoded;
              tempBuffer = secretKey;
            } else {
              throw new Error('Invalid hex key length');
            }
          } catch {
            throw new Error('Invalid private key format. Expected base58, base64, or hex string.');
          }
        }
      }
    } else {
      secretKey = privateKey;
    }

    let keypair: Keypair;
    if (secretKey.length === 32) {
      keypair = Keypair.fromSeed(secretKey);
    } else if (secretKey.length === 64) {
      keypair = Keypair.fromSecretKey(secretKey);
    } else {
      throw new Error('Invalid private key length. Expected 32 or 64 bytes.');
    }

    if (tempBuffer && tempBuffer !== secretKey) {
      secureWipe(tempBuffer);
    }

    return new SolanaWallet(keypair);
  }

  /**
   * Import wallet from encrypted data
   * @param encryptedData - Encrypted wallet data
   * @param password - Password used for encryption
   */
  static async fromEncrypted(
    encryptedData: EncryptedWalletData,
    password: string
  ): Promise<SolanaWallet> {
    if (!isWebCryptoAvailable()) {
      throw new Error('Web Crypto API is required for encrypted wallet import');
    }

    const salt = base64ToUint8Array(encryptedData.salt);
    const iv = base64ToUint8Array(encryptedData.iv);
    const encrypted = base64ToUint8Array(encryptedData.encrypted);

    const { key } = await createSecureStorageKey(password, salt);
    const decrypted = await decryptData(encrypted, iv, key);

    try {
      const wallet = SolanaWallet.fromPrivateKey(decrypted);
      return wallet;
    } finally {
      secureWipe(decrypted);
    }
  }

  /**
   * Get the public key (wallet address)
   */
  getPublicKey(): PublicKey {
    this.ensureNotCleared();
    return this.keypair.publicKey;
  }

  /**
   * Get the public key as a string
   */
  getAddress(): string {
    this.ensureNotCleared();
    return this.keypair.publicKey.toBase58();
  }

  /**
   * Get the private key as Uint8Array
   */
  getPrivateKey(): Uint8Array {
    this.ensureNotCleared();
    return new Uint8Array(this.keypair.secretKey);
  }

  /**
   * Get the private key as base64 string
   */
  getPrivateKeyBase64(): string {
    this.ensureNotCleared();
    return uint8ArrayToBase64(this.keypair.secretKey);
  }

  /**
   * Get the private key as hex string
   */
  getPrivateKeyHex(): string {
    this.ensureNotCleared();
    return uint8ArrayToHex(this.keypair.secretKey);
  }

  /**
   * Get the private key as base58 string (Solana's native format)
   */
  getPrivateKeyBase58(): string {
    this.ensureNotCleared();
    return bs58.encode(this.keypair.secretKey);
  }

  /**
   * Encrypt wallet data for secure storage
   * @param password - Password to encrypt with (should be user-provided)
   * @returns Encrypted wallet data that can be safely stored
   */
  async encryptForStorage(password: string): Promise<EncryptedWalletData> {
    this.ensureNotCleared();

    if (!isWebCryptoAvailable()) {
      throw new Error('Web Crypto API is required for encrypted storage');
    }

    const { key, salt } = await createSecureStorageKey(password);
    const privateKey = this.getPrivateKey();
    const { encrypted, iv } = await encryptData(privateKey, key);

    secureWipe(privateKey);

    return {
      encrypted: uint8ArrayToBase64(encrypted),
      iv: uint8ArrayToBase64(iv),
      salt: uint8ArrayToBase64(salt),
      derivationPath: this.derivationPath,
    };
  }

  /**
   * Sign a transaction
   * @param transaction - Solana transaction to sign
   */
  signTransaction(
    transaction: Transaction | VersionedTransaction
  ): Transaction | VersionedTransaction {
    this.ensureNotCleared();

    if (transaction instanceof VersionedTransaction) {
      transaction.sign([this.keypair]);
      return transaction;
    } else {
      transaction.partialSign(this.keypair);
      return transaction;
    }
  }

  /**
   * Sign a message
   * @param message - Message to sign (as Uint8Array or string)
   * @returns Signature as Uint8Array
   */
  signMessage(message: Uint8Array | string): Uint8Array {
    this.ensureNotCleared();

    const messageBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;

    // Solana uses nacl.sign.detached for message signing
    return nacl.sign.detached(messageBytes, this.keypair.secretKey);
  }

  /**
   * Sign a message and return as base64 string
   * @param message - Message to sign (as Uint8Array or string)
   * @returns Signature as base64 string
   */
  signMessageBase64(message: Uint8Array | string): string {
    const signature = this.signMessage(message);
    return uint8ArrayToBase64(signature);
  }

  /**
   * Sign a message and return as base58 string
   * @param message - Message to sign (as Uint8Array or string)
   * @returns Signature as base58 string
   */
  signMessageBase58(message: Uint8Array | string): string {
    const signature = this.signMessage(message);
    return bs58.encode(signature);
  }

  /**
   * Verify a message signature
   * @param message - Original message
   * @param signature - Signature to verify
   * @returns True if signature is valid
   */
  verifyMessage(message: Uint8Array | string, signature: Uint8Array): boolean {
    this.ensureNotCleared();

    const messageBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;

    return nacl.sign.detached.verify(messageBytes, signature, this.keypair.publicKey.toBytes());
  }

  /**
   * Get the derivation path used for this wallet
   */
  getDerivationPath(): string {
    return this.derivationPath;
  }

  /**
   * Add an event listener
   * @param event - Event type to listen for
   * @param listener - Callback function to execute when event is emitted
   * @returns Function to remove the listener
   */
  on(
    event: WalletEventType,
    listener: (data: BalanceChangeEvent | TokenBalanceChangeEvent) => void
  ): () => void {
    this.ensureNotCleared();
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.off(event, listener);
    };
  }

  /**
   * Remove an event listener
   * @param event - Event type
   * @param listener - Callback function to remove
   */
  off(event: WalletEventType, listener: (data: BalanceChangeEvent | TokenBalanceChangeEvent) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  /**
   * Remove all listeners for an event type, or all listeners if no event specified
   * @param event - Optional event type to clear
   */
  removeAllListeners(event?: WalletEventType): void {
    if (event) {
      this.eventListeners.delete(event);
    } else {
      this.eventListeners.clear();
    }
  }

  /**
   * Emit an event to all registered listeners
   * @param event - Event type
   * @param data - Event data
   */
  private emit(event: WalletEventType, data: BalanceChangeEvent | TokenBalanceChangeEvent): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(data);
        } catch (error) {
          // Silently catch errors in listeners to prevent one bad listener from breaking others
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Start monitoring balance changes using Solana Kit WebSocket subscriptions
   * @param connection - Solana RPC connection (used to get WebSocket URL)
   * @param wsUrl - Optional WebSocket URL (if not provided, derived from connection endpoint)
   */
  async startBalanceMonitoring(connection: Connection, wsUrl?: string): Promise<void> {
    this.ensureNotCleared();
    this.stopBalanceMonitoring();

    this.balanceMonitorConnection = connection;

    // Get initial balance
    const initialBalance = await this.getBalance(connection);
    this.lastKnownBalance = initialBalance;

    // Derive WebSocket URL from connection if not provided
    const websocketUrl = wsUrl || this.getWebSocketUrl(connection.rpcEndpoint);

    // Create Solana Kit RPC subscriptions client
    const rpcSubscriptions = createSolanaRpcSubscriptions(websocketUrl);
    const accountAddress = address(this.keypair.publicKey.toString());

    // Create abort controller for cleanup
    const abortController = new AbortController();
    this.balanceMonitorAbortController = abortController;

    // Subscribe to account notifications using async generator
    const accountNotifications = await rpcSubscriptions
      .accountNotifications(accountAddress, {
        commitment: 'confirmed',
      })
      .subscribe({ abortSignal: abortController.signal });

    // Process notifications in background
    (async () => {
      try {
        for await (const notification of accountNotifications) {
          if (this._isCleared || abortController.signal.aborted) {
            break;
          }

          const newBalance = Number(notification.value.lamports) / LAMPORTS_PER_SOL;
          if (this.lastKnownBalance !== null && newBalance !== this.lastKnownBalance) {
            this.emit('balanceChange', {
              previousBalance: this.lastKnownBalance,
              newBalance,
              difference: newBalance - this.lastKnownBalance,
            });
          }
          this.lastKnownBalance = newBalance;
        }
      } catch (error) {
        // Only log if not aborted (abort is expected when stopping)
        if (!abortController.signal.aborted && !this._isCleared) {
          console.error('Error in balance monitoring:', error);
        }
      }
    })();
  }

  /**
   * Convert HTTP RPC endpoint to WebSocket URL
   * @param rpcEndpoint - HTTP RPC endpoint URL
   * @returns WebSocket URL
   */
  private getWebSocketUrl(rpcEndpoint: string): string {
    // Convert http:// or https:// to ws:// or wss://
    if (rpcEndpoint.startsWith('https://')) {
      return rpcEndpoint.replace('https://', 'wss://');
    }
    if (rpcEndpoint.startsWith('http://')) {
      return rpcEndpoint.replace('http://', 'ws://');
    }
    // If already a WebSocket URL, return as is
    if (rpcEndpoint.startsWith('ws://') || rpcEndpoint.startsWith('wss://')) {
      return rpcEndpoint;
    }
    // Default fallback
    return `wss://${rpcEndpoint}`;
  }

  /**
   * Start monitoring token balance changes for a specific token using Solana Kit
   * @param connection - Solana RPC connection
   * @param tokenMint - Token mint address (PublicKey or string)
   * @param wsUrl - Optional WebSocket URL (if not provided, derived from connection endpoint)
   */
  async startTokenBalanceMonitoring(
    connection: Connection,
    tokenMint: PublicKey | string,
    wsUrl?: string
  ): Promise<void> {
    this.ensureNotCleared();

    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const mintString = mintPublicKey.toString();

    // Stop existing subscription if any
    this.stopTokenBalanceMonitoring(tokenMint);

    // Get associated token address
    const associatedTokenAddress = await getAssociatedTokenAddress(
      mintPublicKey,
      this.keypair.publicKey
    );

    // Get initial balance
    const initialBalance = await this.getTokenBalance(connection, mintPublicKey);
    this.lastKnownTokenBalances.set(mintString, initialBalance);

    // Derive WebSocket URL from connection if not provided
    const websocketUrl = wsUrl || this.getWebSocketUrl(connection.rpcEndpoint);

    // Create Solana Kit RPC subscriptions client
    const rpcSubscriptions = createSolanaRpcSubscriptions(websocketUrl);
    const tokenAccountAddress = address(associatedTokenAddress.toString());

    // Create abort controller for cleanup
    const abortController = new AbortController();

    // Subscribe to token account notifications
    const accountNotifications = await rpcSubscriptions
      .accountNotifications(tokenAccountAddress, {
        commitment: 'confirmed',
      })
      .subscribe({ abortSignal: abortController.signal });

    // Store subscription info
    this.tokenBalanceSubscriptions.set(mintString, { abortController, connection });

    // Process notifications in background
    (async () => {
      try {
        for await (const _notification of accountNotifications) {
          if (this._isCleared || abortController.signal.aborted) {
            break;
          }

          try {
            const newBalance = await this.getTokenBalance(connection, mintPublicKey);
            const previousBalance = this.lastKnownTokenBalances.get(mintString) ?? null;
            const previousAmount = previousBalance ? parseFloat(previousBalance.amount) : 0;
            const newAmount = newBalance ? parseFloat(newBalance.amount) : 0;
            const difference = newAmount - previousAmount;

            if (difference !== 0) {
              this.emit('tokenBalanceChange', {
                mint: mintString,
                previousBalance,
                newBalance,
                difference,
              });
            }
            // Always update last known balance to keep it in sync
            this.lastKnownTokenBalances.set(mintString, newBalance);
          } catch {
            // Silently handle errors
          }
        }
      } catch (error) {
        // Only log if not aborted
        if (!abortController.signal.aborted && !this._isCleared) {
          console.error(`Error in token balance monitoring for ${mintString}:`, error);
        }
      }
    })();
  }

  /**
   * Stop monitoring balance changes
   */
  stopBalanceMonitoring(): void {
    if (this.balanceMonitorAbortController) {
      this.balanceMonitorAbortController.abort();
      this.balanceMonitorAbortController = null;
    }
    this.balanceMonitorConnection = null;
    this.lastKnownBalance = null;
  }

  /**
   * Stop monitoring token balance changes for a specific token
   * @param tokenMint - Token mint address (PublicKey or string)
   */
  stopTokenBalanceMonitoring(tokenMint: PublicKey | string): void {
    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const mintString = mintPublicKey.toString();
    const subscription = this.tokenBalanceSubscriptions.get(mintString);

    if (subscription) {
      subscription.abortController.abort();
      this.tokenBalanceSubscriptions.delete(mintString);
      this.lastKnownTokenBalances.delete(mintString);
    }
  }

  /**
   * Stop all token balance monitoring
   */
  stopAllTokenBalanceMonitoring(): void {
    this.tokenBalanceSubscriptions.forEach((subscription) => {
      subscription.abortController.abort();
    });
    this.tokenBalanceSubscriptions.clear();
    this.lastKnownTokenBalances.clear();
  }

  /**
   * Check if balance monitoring is active
   */
  isBalanceMonitoringActive(): boolean {
    return this.balanceMonitorAbortController !== null;
  }

  /**
   * Get SOL balance for this wallet
   * @param connection - Solana RPC connection
   * @returns Balance in SOL (not lamports)
   */
  async getBalance(connection: Connection): Promise<number> {
    this.ensureNotCleared();
    const lamports = await connection.getBalance(this.keypair.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  /**
   * Get SPL token balance for a specific token
   * @param connection - Solana RPC connection
   * @param tokenMint - Token mint address (PublicKey or string)
   * @returns Token balance information
   */
  async getTokenBalance(
    connection: Connection,
    tokenMint: PublicKey | string
  ): Promise<TokenBalance | null> {
    this.ensureNotCleared();

    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const associatedTokenAddress = await getAssociatedTokenAddress(
      mintPublicKey,
      this.keypair.publicKey
    );

    try {
      const tokenAccount = await getAccount(connection, associatedTokenAddress);

      // Get mint info to get decimals
      const mintInfo = await connection.getParsedAccountInfo(mintPublicKey);
      let decimals = 9; // Default fallback
      if (mintInfo.value && 'parsed' in mintInfo.value.data) {
        decimals = mintInfo.value.data.parsed.info.decimals;
      }

      const amount = Number(tokenAccount.amount);
      const uiAmount = amount / Math.pow(10, decimals);

      return {
        mint: mintPublicKey.toBase58(),
        amount: tokenAccount.amount.toString(),
        decimals,
        uiAmount,
      };
    } catch {
      // Account doesn't exist, return null
      return null;
    }
  }

  /**
   * Get all SPL token balances for this wallet
   * @param connection - Solana RPC connection
   * @returns Array of token balances
   */
  async getAllTokenBalances(connection: Connection): Promise<TokenBalance[]> {
    this.ensureNotCleared();

    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(this.keypair.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    });

    return tokenAccounts.value.map((account) => {
      const parsedInfo = account.account.data.parsed.info;
      return {
        mint: parsedInfo.mint,
        amount: parsedInfo.tokenAmount.amount,
        decimals: parsedInfo.tokenAmount.decimals,
        uiAmount: parsedInfo.tokenAmount.uiAmount || 0,
      };
    });
  }

  /**
   * Send SOL to another address
   * @param connection - Solana RPC connection
   * @param to - Recipient address (PublicKey or string)
   * @param amount - Amount in SOL (not lamports)
   * @param options - Optional transaction options
   * @returns Transaction signature
   */
  async sendSol(
    connection: Connection,
    to: PublicKey | string,
    amount: number,
    options?: {
      skipPreflight?: boolean;
      maxRetries?: number;
    }
  ): Promise<string> {
    this.ensureNotCleared();

    const toPublicKey = typeof to === 'string' ? new PublicKey(to) : to;
    const lamports = amount * LAMPORTS_PER_SOL;

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.keypair.publicKey,
        toPubkey: toPublicKey,
        lamports,
      })
    );

    const previousBalance = await this.getBalance(connection);

    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [this.keypair],
      {
        skipPreflight: options?.skipPreflight,
        maxRetries: options?.maxRetries,
      }
    );

    // Emit balance change event
    try {
      const newBalance = await this.getBalance(connection);
      if (previousBalance !== newBalance) {
        this.emit('balanceChange', {
          previousBalance,
          newBalance,
          difference: newBalance - previousBalance,
        });
      }
    } catch {
      // Silently handle errors when fetching balance after send
    }

    return signature;
  }

  /**
   * Send SPL tokens to another address
   * @param connection - Solana RPC connection
   * @param tokenMint - Token mint address (PublicKey or string)
   * @param to - Recipient address (PublicKey or string)
   * @param amount - Amount in token's smallest unit (considering decimals)
   * @param options - Optional transaction options
   * @returns Transaction signature
   */
  async sendToken(
    connection: Connection,
    tokenMint: PublicKey | string,
    to: PublicKey | string,
    amount: number,
    options?: {
      skipPreflight?: boolean;
      maxRetries?: number;
      decimals?: number;
    }
  ): Promise<string> {
    this.ensureNotCleared();

    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const toPublicKey = typeof to === 'string' ? new PublicKey(to) : to;

    // Get source and destination token accounts
    const fromTokenAddress = await getAssociatedTokenAddress(mintPublicKey, this.keypair.publicKey);
    const toTokenAddress = await getAssociatedTokenAddress(mintPublicKey, toPublicKey);

    // Get token decimals if not provided
    let decimals = options?.decimals;
    if (!decimals) {
      try {
        const mintInfo = await connection.getParsedAccountInfo(mintPublicKey);
        if (mintInfo.value && 'parsed' in mintInfo.value.data) {
          decimals = mintInfo.value.data.parsed.info.decimals;
        } else {
          decimals = 9; // Default fallback
        }
      } catch {
        decimals = 9; // Default fallback
      }
    }

    // Convert amount to token's smallest unit
    const finalDecimals = decimals || 9;
    const amountInSmallestUnit = BigInt(Math.floor(amount * Math.pow(10, finalDecimals)));

    const transaction = new Transaction().add(
      createTransferInstruction(
        fromTokenAddress,
        toTokenAddress,
        this.keypair.publicKey,
        amountInSmallestUnit,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const previousTokenBalance = await this.getTokenBalance(connection, mintPublicKey);

    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [this.keypair],
      {
        skipPreflight: options?.skipPreflight,
        maxRetries: options?.maxRetries,
      }
    );

    // Emit token balance change event
    try {
      const newTokenBalance = await this.getTokenBalance(connection, mintPublicKey);
      const previousAmount = previousTokenBalance ? parseFloat(previousTokenBalance.amount) : 0;
      const newAmount = newTokenBalance ? parseFloat(newTokenBalance.amount) : 0;
      const difference = newAmount - previousAmount;

      if (difference !== 0) {
        this.emit('tokenBalanceChange', {
          mint: mintPublicKey.toString(),
          previousBalance: previousTokenBalance,
          newBalance: newTokenBalance,
          difference,
        });
      }
    } catch {
      // Silently handle errors when fetching token balance after send
    }

    return signature;
  }

  /**
   * Get transaction activity for this wallet
   * @param connection - Solana RPC connection
   * @param options - Options for fetching transactions
   * @returns Array of transaction activities
   */
  async getTransactionActivity(
    connection: Connection,
    options?: {
      limit?: number;
      before?: string;
      until?: string;
    }
  ): Promise<TransactionActivity[]> {
    this.ensureNotCleared();

    const limit = options?.limit || 20;
    const signatures = await connection.getSignaturesForAddress(
      this.keypair.publicKey,
      {
        limit,
        before: options?.before,
        until: options?.until,
      }
    );

    const activities: TransactionActivity[] = [];

    for (const sigInfo of signatures) {
      try {
        const tx = await connection.getParsedTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });

        const activity = this.parseTransactionActivity(sigInfo, tx, this.keypair.publicKey);
        activities.push(activity);
      } catch {
        // If we can't parse the transaction, add basic info
        activities.push({
          signature: sigInfo.signature,
          slot: sigInfo.slot,
          blockTime: sigInfo.blockTime ?? null,
          err: sigInfo.err,
          type: 'other',
        });
      }
    }

    return activities;
  }

  /**
   * Parse transaction to determine activity type and details
   * @private
   */
  private parseTransactionActivity(
    sigInfo: ConfirmedSignatureInfo,
    tx: ParsedTransactionWithMeta | null,
    walletPubkey: PublicKey
  ): TransactionActivity {
    if (!tx || !tx.meta) {
      return {
        signature: sigInfo.signature,
        slot: sigInfo.slot,
        blockTime: sigInfo.blockTime ?? null,
        err: sigInfo.err,
        type: 'other',
      };
    }

    const walletAddress = walletPubkey.toBase58();
    let type: 'send' | 'receive' | 'other' = 'other';
    let amount: number | undefined;
    let tokenMint: string | undefined;
    let memo: string | undefined;

    // Check for memo
    if (tx.transaction.message.instructions) {
      for (const ix of tx.transaction.message.instructions) {
        if ('parsed' in ix && ix.parsed?.type === 'memo') {
          memo = ix.parsed.memo;
        }
      }
    }

    // Find wallet's account index
    const accountKeys = tx.transaction.message.accountKeys.map((key) =>
      typeof key === 'string' ? key : key.pubkey.toBase58()
    );
    const walletIndex = accountKeys.findIndex((key) => key === walletAddress);

    // Check for SOL transfers
    if (walletIndex >= 0) {
      const preBalance = tx.meta.preBalances[walletIndex] || 0;
      const postBalance = tx.meta.postBalances[walletIndex] || 0;
      const balanceChange = (postBalance - preBalance) / LAMPORTS_PER_SOL;

      if (Math.abs(balanceChange) > 0.000001) {
        type = balanceChange > 0 ? 'receive' : 'send';
        amount = Math.abs(balanceChange);
      }
    }

    // Check for token transfers
    if (tx.meta.postTokenBalances && tx.meta.postTokenBalances.length > 0) {
      for (const balance of tx.meta.postTokenBalances) {
        if (balance.owner === walletAddress) {
          tokenMint = balance.mint;
          const uiAmount = balance.uiTokenAmount.uiAmount;
          if (uiAmount && uiAmount !== 0) {
            // Token transfers override SOL transfers
            type = uiAmount > 0 ? 'receive' : 'send';
            amount = Math.abs(uiAmount);
          }
        }
      }
    }

    return {
      signature: sigInfo.signature,
      slot: sigInfo.slot,
      blockTime: sigInfo.blockTime ?? null,
      err: sigInfo.err,
      memo,
      type,
      amount,
      tokenMint,
    };
  }

  /**
   * Securely clear the wallet from memory
   * After calling this, the wallet cannot be used for signing
   */
  clear(): void {
    if (this._isCleared) {
      return;
    }

    // Stop balance monitoring
    this.stopBalanceMonitoring();

    // Stop all token balance monitoring
    this.stopAllTokenBalanceMonitoring();

    // Remove all event listeners
    this.removeAllListeners();

    secureWipe(this.keypair.secretKey);

    this._isCleared = true;
  }

  /**
   * Check if the wallet has been cleared
   */
  isCleared(): boolean {
    return this._isCleared;
  }

  /**
   * Ensure the wallet has not been cleared
   * @private
   */
  private ensureNotCleared(): void {
    if (this._isCleared) {
      throw new Error('Wallet has been cleared and can no longer be used');
    }
  }
}
