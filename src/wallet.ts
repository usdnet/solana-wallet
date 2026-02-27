/**
 * Solana self-custodial wallet functionality
 */

import { Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
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

/**
 * Self-custodial Solana wallet class
 */
export class SolanaWallet {
  private keypair: Keypair;
  private derivationPath: string;
  private _isCleared: boolean = false;

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
   * Securely clear the wallet from memory
   * After calling this, the wallet cannot be used for signing
   */
  clear(): void {
    if (this._isCleared) {
      return;
    }

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
