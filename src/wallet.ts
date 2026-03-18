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
  AccountInfo,
} from '@solana/web3.js';
import { address, createSolanaRpcSubscriptions } from '@solana/kit';
import { getAccount, getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID, unpackAccount } from '@solana/spl-token';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import * as nacl from 'tweetnacl';
import * as bs58 from 'bs58';
import {
  secureWipe,
} from './security';
import { base64ToUint8Array, uint8ArrayToBase64, hexToUint8Array } from './utils';

export interface WalletOptions {
  derivationPath?: string;
}

export interface WalletWithMnemonic {
  wallet: SolanaWallet;
  mnemonic: string;
}

export interface WalletWithPrivateKey {
  wallet: SolanaWallet;
  privateKey: string; // Base58 encoded private key
}

export interface SigningCredentials {
  seedPhrase?: string;
  privateKey?: string | Uint8Array;
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
  private publicKey: PublicKey;
  private derivationPath: string;
  private eventListeners: Map<
    WalletEventType,
    Set<(data: BalanceChangeEvent | TokenBalanceChangeEvent) => void>
  > = new Map();
  private balanceMonitorAbortController: AbortController | null = null;
  private balanceMonitorConnection: Connection | null = null;
  private tokenBalanceSubscriptions: Map<string, {
    abortController: AbortController;
    connection: Connection;
    decimals: number;
    onAccountChangeSubscriptionId?: number;
  }> = new Map();
  private lastKnownBalance: number | null = null;
  private lastKnownTokenBalances: Map<string, TokenBalance | null> = new Map();

  private constructor(publicKey: PublicKey, derivationPath: string = "m/44'/501'/0'/0'") {
    this.publicKey = publicKey;
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
    return new SolanaWallet(keypair.publicKey, options.derivationPath);
  }

  /**
   * Create a new wallet with a random keypair and return the private key
   * The private key is returned but NOT stored in the wallet
   * @param options - Optional wallet options
   * @returns Wallet and private key (base58 encoded)
   */
  static createWithPrivateKey(options: WalletOptions = {}): WalletWithPrivateKey {
    const keypair = Keypair.generate();
    const wallet = new SolanaWallet(keypair.publicKey, options.derivationPath);
    const privateKey = bs58.encode(keypair.secretKey);
    secureWipe(keypair.secretKey);
    return { wallet, privateKey };
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
   * Validate if a seed phrase matches a given wallet address
   * @param address - Wallet address to check against
   * @param mnemonic - Seed phrase to validate
   * @param derivationPath - Optional derivation path (default: m/44'/501'/0'/0')
   * @returns True if the seed phrase generates the given address
   */
  static validateSeedPhrase(
    address: string,
    mnemonic: string,
    derivationPath?: string
  ): boolean {
    try {
      if (!bip39.validateMnemonic(mnemonic)) {
        return false;
      }

      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const path = derivationPath || "m/44'/501'/0'/0'";
      const derivedSeed = derivePath(path, seed.toString('hex')).key;
      const keypair = Keypair.fromSeed(derivedSeed);
      const generatedAddress = keypair.publicKey.toBase58();

      secureWipe(seed);
      secureWipe(derivedSeed);

      return generatedAddress === address;
    } catch {
      return false;
    }
  }

  /**
   * Validate if a private key matches a given wallet address
   * @param address - Wallet address to check against
   * @param privateKey - Private key to validate (Uint8Array or string)
   * @returns True if the private key generates the given address
   */
  static validatePrivateKey(address: string, privateKey: Uint8Array | string): boolean {
    try {
      let secretKey: Uint8Array;

      if (typeof privateKey === 'string') {
        try {
          const decoded = bs58.decode(privateKey);
          if (decoded.length === 64 || decoded.length === 32) {
            secretKey = decoded;
          } else {
            return false;
          }
        } catch {
          try {
            const decoded = base64ToUint8Array(privateKey);
            if (decoded.length === 64 || decoded.length === 32) {
              secretKey = decoded;
            } else {
              return false;
            }
          } catch {
            try {
              const hexString = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
              const decoded = hexToUint8Array(hexString);
              if (decoded.length === 64 || decoded.length === 32) {
                secretKey = decoded;
              } else {
                return false;
              }
            } catch {
              return false;
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
        return false;
      }

      const generatedAddress = keypair.publicKey.toBase58();
      return generatedAddress === address;
    } catch {
      return false;
    }
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

    return new SolanaWallet(keypair.publicKey, derivationPath);
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

    return new SolanaWallet(keypair.publicKey);
  }


  /**
   * Get the public key (wallet address)
   */
  getPublicKey(): PublicKey {
    return this.publicKey;
  }

  /**
   * Get the public key as a string
   */
  getAddress(): string {
    return this.publicKey.toBase58();
  }



  /**
   * Get a keypair from signing credentials
   * @private
   */
  private static getKeypairFromCredentials(credentials: SigningCredentials): Keypair {
    if (credentials.seedPhrase) {
      if (!bip39.validateMnemonic(credentials.seedPhrase)) {
        throw new Error('Invalid mnemonic phrase');
      }
      const seed = bip39.mnemonicToSeedSync(credentials.seedPhrase);
      const path = credentials.derivationPath || "m/44'/501'/0'/0'";
      const derivedSeed = derivePath(path, seed.toString('hex')).key;
      const keypair = Keypair.fromSeed(derivedSeed);
      secureWipe(seed);
      secureWipe(derivedSeed);
      return keypair;
    } else if (credentials.privateKey) {
      let secretKey: Uint8Array;
      if (typeof credentials.privateKey === 'string') {
        try {
          const decoded = bs58.decode(credentials.privateKey);
          if (decoded.length === 64 || decoded.length === 32) {
            secretKey = decoded;
          } else {
            throw new Error('Invalid base58 key length');
          }
        } catch {
          try {
            const decoded = base64ToUint8Array(credentials.privateKey);
            if (decoded.length === 64 || decoded.length === 32) {
              secretKey = decoded;
            } else {
              throw new Error('Invalid base64 key length');
            }
          } catch {
            try {
              const hexString = credentials.privateKey.startsWith('0x') ? credentials.privateKey.slice(2) : credentials.privateKey;
              const decoded = hexToUint8Array(hexString);
              if (decoded.length === 64 || decoded.length === 32) {
                secretKey = decoded;
              } else {
                throw new Error('Invalid hex key length');
              }
            } catch {
              throw new Error('Invalid private key format. Expected base58, base64, or hex string.');
            }
          }
        }
      } else {
        secretKey = credentials.privateKey;
      }
      if (secretKey.length === 32) {
        return Keypair.fromSeed(secretKey);
      } else if (secretKey.length === 64) {
        return Keypair.fromSecretKey(secretKey);
      } else {
        throw new Error('Invalid private key length. Expected 32 or 64 bytes.');
      }
    } else {
      throw new Error('Either seedPhrase or privateKey must be provided in credentials');
    }
  }

  /**
   * Sign a transaction
   * @param transaction - Solana transaction to sign
   * @param credentials - Signing credentials object with either seedPhrase or privateKey
   */
  signTransaction(
    transaction: Transaction | VersionedTransaction,
    credentials: SigningCredentials
  ): Transaction | VersionedTransaction {

    const walletAddress = this.publicKey.toBase58();
    const signingKeypair = SolanaWallet.getKeypairFromCredentials(credentials);

    if (signingKeypair.publicKey.toBase58() !== walletAddress) {
      throw new Error('Provided credentials do not match this wallet address');
    }

    if (transaction instanceof VersionedTransaction) {
      transaction.sign([signingKeypair]);
      return transaction;
    } else {
      transaction.partialSign(signingKeypair);
      return transaction;
    }
  }

  /**
   * Sign a message
   * @param message - Message to sign (as Uint8Array or string)
   * @param credentials - Signing credentials object with either seedPhrase or privateKey
   * @returns Signature as Uint8Array
   */
  signMessage(
    message: Uint8Array | string,
    credentials: SigningCredentials
  ): Uint8Array {

    const walletAddress = this.publicKey.toBase58();
    const signingKeypair = SolanaWallet.getKeypairFromCredentials(credentials);

    if (signingKeypair.publicKey.toBase58() !== walletAddress) {
      throw new Error('Provided credentials do not match this wallet address');
    }

    const messageBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;

    return nacl.sign.detached(messageBytes, signingKeypair.secretKey);
  }

  /**
   * Sign a message and return as base64 string
   * @param message - Message to sign (as Uint8Array or string)
   * @param credentials - Signing credentials object with either seedPhrase or privateKey
   * @returns Signature as base64 string
   */
  signMessageBase64(
    message: Uint8Array | string,
    credentials: SigningCredentials
  ): string {
    const signature = this.signMessage(message, credentials);
    return uint8ArrayToBase64(signature);
  }

  /**
   * Sign a message and return as base58 string
   * @param message - Message to sign (as Uint8Array or string)
   * @param credentials - Signing credentials object with either seedPhrase or privateKey
   * @returns Signature as base58 string
   */
  signMessageBase58(
    message: Uint8Array | string,
    credentials: SigningCredentials
  ): string {
    const signature = this.signMessage(message, credentials);
    return bs58.encode(signature);
  }

  /**
   * Verify a message signature
   * @param message - Original message
   * @param signature - Signature to verify
   * @returns True if signature is valid
   */
  verifyMessage(message: Uint8Array | string, signature: Uint8Array): boolean {

    const messageBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;

    return nacl.sign.detached.verify(messageBytes, signature, this.publicKey.toBytes());
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
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);

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
    this.stopBalanceMonitoring();

    this.balanceMonitorConnection = connection;

    // Get initial balance
    const initialBalance = await this.getBalance(connection);
    this.lastKnownBalance = initialBalance;

    // Derive WebSocket URL from connection if not provided
    const websocketUrl = wsUrl || this.getWebSocketUrl(connection.rpcEndpoint);

    // Create Solana Kit RPC subscriptions client
    const rpcSubscriptions = createSolanaRpcSubscriptions(websocketUrl);
    const accountAddress = address(this.publicKey.toString());

    // Create abort controller for cleanup
    const abortController = new AbortController();
    this.balanceMonitorAbortController = abortController;

    // Subscribe to account notifications using async generator
    const accountNotifications = await rpcSubscriptions
      .accountNotifications(accountAddress, {
        commitment: 'confirmed',
      })
      .subscribe({ abortSignal: abortController.signal });

    (async () => {
      try {
        for await (const notification of accountNotifications) {
          if (abortController.signal.aborted) {
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
        if (!abortController.signal.aborted) {
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
    if (rpcEndpoint.startsWith('https://')) {
      return rpcEndpoint.replace('https://', 'wss://');
    }
    if (rpcEndpoint.startsWith('http://')) {
      return rpcEndpoint.replace('http://', 'ws://');
    }
    if (rpcEndpoint.startsWith('ws://') || rpcEndpoint.startsWith('wss://')) {
      return rpcEndpoint;
    }
    return `wss://${rpcEndpoint}`;
  }

  /**
   * Start monitoring token balance changes for a specific token using Solana Kit
   * If the account doesn't exist, monitors Token Program logs for account creation
   * @param connection - Solana RPC connection
   * @param tokenMint - Token mint address (PublicKey or string)
   */
  async startTokenBalanceMonitoring(
    connection: Connection,
    tokenMint: PublicKey | string
  ): Promise<void> {

    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const mintString = mintPublicKey.toString();

    this.stopTokenBalanceMonitoring(tokenMint);

    const associatedTokenAddress = await getAssociatedTokenAddress(
      mintPublicKey,
      this.publicKey
    );

    const initialBalance = await this.getTokenBalance(connection, mintPublicKey);
    this.lastKnownTokenBalances.set(mintString, initialBalance);

    let decimals = 9;
    try {
      const mintInfo = await connection.getParsedAccountInfo(mintPublicKey);
      if (mintInfo.value && 'parsed' in mintInfo.value.data) {
        decimals = mintInfo.value.data.parsed.info.decimals;
      }
    } catch {
      // Ignore
    }

    const abortController = new AbortController();

    this.tokenBalanceSubscriptions.set(mintString, { abortController, connection, decimals });

    this.startTokenAccountMonitoring(
      associatedTokenAddress,
      mintPublicKey,
      mintString,
      abortController,
      connection,
      decimals
    );
  }

  /**
   * Start monitoring token account using Connection.onAccountChange
   * Works for both existing and non-existent accounts
   * @private
   */
  private startTokenAccountMonitoring(
    associatedTokenAddress: PublicKey,
    mintPublicKey: PublicKey,
    mintString: string,
    abortController: AbortController,
    connection: Connection,
    decimals: number
  ): void {
    const handleAccountChange = (accountInfo: AccountInfo<Buffer> | null) => {
      if (abortController.signal.aborted) {
        return;
      }

      if (!accountInfo || !accountInfo.data) {
        const previousBalance = this.lastKnownTokenBalances.get(mintString) ?? null;
        if (previousBalance !== null) {
          this.emit('tokenBalanceChange', {
            mint: mintString,
            previousBalance,
            newBalance: null,
            difference: -parseFloat(previousBalance.amount),
          });
          this.lastKnownTokenBalances.set(mintString, null);
        } else {
          this.lastKnownTokenBalances.set(mintString, null);
        }
        return;
      }

      try {
        const tokenAccount = unpackAccount(associatedTokenAddress, accountInfo, TOKEN_PROGRAM_ID);
        const amountNumber = Number(tokenAccount.amount);
        const uiAmount = amountNumber / Math.pow(10, decimals);

        const newBalance: TokenBalance = {
          mint: mintString,
          amount: tokenAccount.amount.toString(),
          decimals,
          uiAmount,
        };

        const previousBalance = this.lastKnownTokenBalances.get(mintString) ?? null;
        const previousAmount = previousBalance ? parseFloat(previousBalance.amount) : 0;
        const newAmount = parseFloat(newBalance.amount);
        const difference = newAmount - previousAmount;

        if (difference !== 0 || previousBalance === null) {
          this.emit('tokenBalanceChange', {
            mint: mintString,
            previousBalance,
            newBalance,
            difference,
          });
        }

        this.lastKnownTokenBalances.set(mintString, newBalance);
      } catch {
        this.handleTokenBalanceFallback(connection, mintPublicKey, mintString);
      }
    };

    const subscriptionId = connection.onAccountChange(
      associatedTokenAddress,
      handleAccountChange,
      'confirmed'
    );

    const subscription = this.tokenBalanceSubscriptions.get(mintString);
    if (subscription) {
      subscription.onAccountChangeSubscriptionId = subscriptionId;
    }
  }


  /**
   * Fallback to RPC call when parsing fails
   * @private
   */
  private async handleTokenBalanceFallback(
    connection: Connection,
    mintPublicKey: PublicKey,
    mintString: string
  ): Promise<void> {
    try {
      const newBalance = await this.getTokenBalance(connection, mintPublicKey);
      const previousBalance = this.lastKnownTokenBalances.get(mintString) ?? null;
      const previousAmount = previousBalance ? parseFloat(previousBalance.amount) : 0;
      const newAmount = newBalance ? parseFloat(newBalance.amount) : 0;
      const difference = newAmount - previousAmount;

      if (difference !== 0 || (previousBalance === null && newBalance !== null) || (previousBalance !== null && newBalance === null)) {
        this.emit('tokenBalanceChange', {
          mint: mintString,
          previousBalance,
          newBalance,
          difference,
        });
      }
      this.lastKnownTokenBalances.set(mintString, newBalance);
    } catch {
      // Handle errors silently
    }
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
      if (subscription.onAccountChangeSubscriptionId !== undefined) {
        subscription.connection.removeAccountChangeListener(subscription.onAccountChangeSubscriptionId);
      }
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
      if (subscription.onAccountChangeSubscriptionId !== undefined) {
        subscription.connection.removeAccountChangeListener(subscription.onAccountChangeSubscriptionId);
      }
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
    const lamports = await connection.getBalance(this.publicKey);
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

    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const associatedTokenAddress = await getAssociatedTokenAddress(
      mintPublicKey,
      this.publicKey
    );

    try {
      const tokenAccount = await getAccount(connection, associatedTokenAddress);

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
      return null;
    }
  }

  /**
   * Get all SPL token balances for this wallet
   * @param connection - Solana RPC connection
   * @returns Array of token balances
   */
  async getAllTokenBalances(connection: Connection): Promise<TokenBalance[]> {

    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(this.publicKey, {
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
   * @param credentials - Signing credentials object with either seedPhrase or privateKey
   * @param options - Optional transaction options
   * @returns Transaction signature
   */
  async sendSol(
    connection: Connection,
    to: PublicKey | string,
    amount: number,
    credentials: SigningCredentials,
    options?: {
      skipPreflight?: boolean;
      maxRetries?: number;
    }
  ): Promise<string> {

    const walletAddress = this.publicKey.toBase58();
    const signingKeypair = SolanaWallet.getKeypairFromCredentials(credentials);

    if (signingKeypair.publicKey.toBase58() !== walletAddress) {
      throw new Error('Provided credentials do not match this wallet address');
    }

    const toPublicKey = typeof to === 'string' ? new PublicKey(to) : to;
    const lamports = amount * LAMPORTS_PER_SOL;

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.publicKey,
        toPubkey: toPublicKey,
        lamports,
      })
    );

    const previousBalance = await this.getBalance(connection);

    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [signingKeypair],
      {
        skipPreflight: options?.skipPreflight,
        maxRetries: options?.maxRetries,
      }
    );

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
      // Ignore
    }

    return signature;
  }

  /**
   * Estimate transaction fee for sending SOL
   * @param connection - Solana RPC connection
   * @param to - Recipient address (PublicKey or string)
   * @param amount - Amount in SOL (not lamports)
   * @returns Estimated fee in SOL
   */
  async estimateSendSolFee(
    connection: Connection,
    to: PublicKey | string,
    amount: number
  ): Promise<number> {

    const toPublicKey = typeof to === 'string' ? new PublicKey(to) : to;
    const lamports = amount * LAMPORTS_PER_SOL;

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.publicKey,
        toPubkey: toPublicKey,
        lamports,
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.publicKey;

    const feeResponse = await connection.getFeeForMessage(transaction.compileMessage());

    if (!feeResponse || feeResponse.value === null || feeResponse.value === undefined) {
      return 0.000005;
    }

    return Number(feeResponse.value) / LAMPORTS_PER_SOL;
  }

  /**
   * Send SPL tokens to another address
   * @param connection - Solana RPC connection
   * @param tokenMint - Token mint address (PublicKey or string)
   * @param to - Recipient address (PublicKey or string)
   * @param amount - Amount in token's smallest unit (considering decimals)
   * @param credentials - Signing credentials object with either seedPhrase or privateKey
   * @param options - Optional transaction options
   * @returns Transaction signature
   */
  async sendToken(
    connection: Connection,
    tokenMint: PublicKey | string,
    to: PublicKey | string,
    amount: number,
    credentials: SigningCredentials,
    options?: {
      skipPreflight?: boolean;
      maxRetries?: number;
      decimals?: number;
    }
  ): Promise<string> {

    const walletAddress = this.publicKey.toBase58();
    const signingKeypair = SolanaWallet.getKeypairFromCredentials(credentials);

    if (signingKeypair.publicKey.toBase58() !== walletAddress) {
      throw new Error('Provided credentials do not match this wallet address');
    }

    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const toPublicKey = typeof to === 'string' ? new PublicKey(to) : to;

    const fromTokenAddress = await getAssociatedTokenAddress(mintPublicKey, this.publicKey);
    const toTokenAddress = await getAssociatedTokenAddress(mintPublicKey, toPublicKey);
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

    const finalDecimals = decimals || 9;
    const amountInSmallestUnit = BigInt(Math.floor(amount * Math.pow(10, finalDecimals)));

    const transaction = new Transaction().add(
      createTransferInstruction(
        fromTokenAddress,
        toTokenAddress,
        this.publicKey,
        amountInSmallestUnit,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const previousTokenBalance = await this.getTokenBalance(connection, mintPublicKey);

    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [signingKeypair],
      {
        skipPreflight: options?.skipPreflight,
        maxRetries: options?.maxRetries,
      }
    );

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
      // Ignore
    }

    return signature;
  }

  /**
   * Estimate transaction fee for sending SPL tokens
   * @param connection - Solana RPC connection
   * @param tokenMint - Token mint address (PublicKey or string)
   * @param to - Recipient address (PublicKey or string)
   * @param amount - Amount in token's smallest unit (considering decimals)
   * @param options - Optional options including decimals
   * @returns Estimated fee in SOL
   */
  async estimateSendTokenFee(
    connection: Connection,
    tokenMint: PublicKey | string,
    to: PublicKey | string,
    amount: number,
    options?: {
      decimals?: number;
    }
  ): Promise<number> {

    const mintPublicKey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    const toPublicKey = typeof to === 'string' ? new PublicKey(to) : to;

    const fromTokenAddress = await getAssociatedTokenAddress(mintPublicKey, this.publicKey);
    const toTokenAddress = await getAssociatedTokenAddress(mintPublicKey, toPublicKey);

    let decimals = options?.decimals;
    if (!decimals) {
      try {
        const mintInfo = await connection.getParsedAccountInfo(mintPublicKey);
        if (mintInfo.value && 'parsed' in mintInfo.value.data) {
          decimals = mintInfo.value.data.parsed.info.decimals;
        } else {
          decimals = 9;
        }
      } catch {
        decimals = 9;
      }
    }

    const finalDecimals = decimals || 9;
    const amountInSmallestUnit = BigInt(Math.floor(amount * Math.pow(10, finalDecimals)));

    const transaction = new Transaction().add(
      createTransferInstruction(
        fromTokenAddress,
        toTokenAddress,
        this.publicKey,
        amountInSmallestUnit,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.publicKey;

    const feeResponse = await connection.getFeeForMessage(transaction.compileMessage());

    if (!feeResponse || feeResponse.value === null || feeResponse.value === undefined) {
      return 0.000005;
    }

    return Number(feeResponse.value) / LAMPORTS_PER_SOL;
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

    const limit = options?.limit || 20;

    const isPaginating = !!options?.before;
    const fetchLimit = isPaginating
      ? Math.min(limit + 5, 50)
      : Math.min(Math.max(limit * 2, 20), 100);

    const walletSignatures = await connection.getSignaturesForAddress(
      this.publicKey,
      {
        limit: fetchLimit,
        before: options?.before,
        until: options?.until,
      }
    );

    let tokenAccountSignatures: ConfirmedSignatureInfo[] = [];

    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        this.publicKey,
        {
          programId: TOKEN_PROGRAM_ID,
        }
      );

      const maxTokenAccountsToQuery = 20;
      const tokenAccountsToQuery = tokenAccounts.value.slice(0, maxTokenAccountsToQuery);

      const perAccountLimit = isPaginating
        ? Math.min(limit + 3, 30)
        : Math.min(Math.max(limit, 10), 50);

      const tokenAccountPromises = tokenAccountsToQuery.map((account) =>
        connection.getSignaturesForAddress(account.pubkey, {
          limit: perAccountLimit,
          before: options?.before,
          until: options?.until,
        }).catch(() => [] as ConfirmedSignatureInfo[])
      );

      const tokenAccountResults = await Promise.all(tokenAccountPromises);
      tokenAccountSignatures = tokenAccountResults.flat();
    } catch {
      void 0;
    }

    const signatureMap = new Map<string, ConfirmedSignatureInfo>();

    for (const sigInfo of walletSignatures) {
      signatureMap.set(sigInfo.signature, sigInfo);
    }

    for (const sigInfo of tokenAccountSignatures) {
      if (!signatureMap.has(sigInfo.signature)) {
        signatureMap.set(sigInfo.signature, sigInfo);
      }
    }

    const allSignatures = Array.from(signatureMap.values()).sort((a, b) => {
      const timeA = a.blockTime ?? 0;
      const timeB = b.blockTime ?? 0;
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      return b.slot - a.slot;
    });

    const limitedSignatures = allSignatures.slice(0, limit);

    const activities: TransactionActivity[] = [];

    const transactionPromises = limitedSignatures.map(async (sigInfo) => {
      try {
        const tx = await connection.getParsedTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });

        return this.parseTransactionActivity(sigInfo, tx, this.publicKey);
      } catch {
        return {
          signature: sigInfo.signature,
          slot: sigInfo.slot,
          blockTime: sigInfo.blockTime ?? null,
          err: sigInfo.err,
          type: 'other' as const,
        };
      }
    });

    const results = await Promise.all(transactionPromises);
    activities.push(...results);

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

    const instructions = tx.transaction.message.instructions;
    if (instructions) {
      for (const ix of instructions) {
        if ('parsed' in ix && ix.parsed?.type === 'memo') {
          memo = ix.parsed.memo;
          break;
        }
      }
    }

    const accountKeys = tx.transaction.message.accountKeys;
    let walletIndex = -1;
    for (let i = 0; i < accountKeys.length; i++) {
      const key = accountKeys[i];
      const keyStr = typeof key === 'string' ? key : key.pubkey.toBase58();
      if (keyStr === walletAddress) {
        walletIndex = i;
        break;
      }
    }

    if (walletIndex >= 0) {
      const preBalance = tx.meta.preBalances[walletIndex] || 0;
      const postBalance = tx.meta.postBalances[walletIndex] || 0;
      const balanceChange = (postBalance - preBalance) / LAMPORTS_PER_SOL;

      if (Math.abs(balanceChange) > 0.000001) {
        type = balanceChange > 0 ? 'receive' : 'send';
        amount = Math.abs(balanceChange);
      }
    }

    const preTokenBalances = tx.meta.preTokenBalances || [];
    const postTokenBalances = tx.meta.postTokenBalances || [];

    if (preTokenBalances.length > 0 || postTokenBalances.length > 0) {
      const preBalanceMap = new Map<string, typeof preTokenBalances[0]>();
      for (const preBalance of preTokenBalances) {
        if (preBalance.owner === walletAddress) {
          const accountKey = `${preBalance.accountIndex}-${preBalance.mint}`;
          preBalanceMap.set(accountKey, preBalance);
        }
      }

      const processedAccounts = new Set<string>();

      for (const postBalance of postTokenBalances) {
        if (postBalance.owner === walletAddress) {
          const accountKey = `${postBalance.accountIndex}-${postBalance.mint}`;
          processedAccounts.add(accountKey);

          tokenMint = postBalance.mint;

          const preBalance = preBalanceMap.get(accountKey);
          const preAmount = preBalance?.uiTokenAmount.uiAmount ?? 0;
          const postAmount = postBalance.uiTokenAmount.uiAmount ?? 0;
          const transferAmount = postAmount - preAmount;

          if (Math.abs(transferAmount) > 0.00000001) {
            type = transferAmount > 0 ? 'receive' : 'send';
            amount = Math.abs(transferAmount);
          }
        }
      }

      for (const preBalance of preTokenBalances) {
        if (preBalance.owner === walletAddress) {
          const accountKey = `${preBalance.accountIndex}-${preBalance.mint}`;
          if (!processedAccounts.has(accountKey)) {
            tokenMint = preBalance.mint;
            const preAmount = preBalance.uiTokenAmount.uiAmount ?? 0;
            const transferAmount = 0 - preAmount;

            if (Math.abs(transferAmount) > 0.00000001) {
              type = 'send';
              amount = Math.abs(transferAmount);
            }
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

}
