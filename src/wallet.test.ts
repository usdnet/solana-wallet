/**
 * Tests for SolanaWallet
 */

import { describe, it, expect } from 'vitest';
import { SolanaWallet } from './wallet';
import { Keypair, Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import * as bip39 from 'bip39';
import * as bs58 from 'bs58';

describe('SolanaWallet', () => {
  describe('create', () => {
    it('should create a new wallet with random keypair', () => {
      const wallet = SolanaWallet.create();
      expect(wallet).toBeInstanceOf(SolanaWallet);
      expect(wallet.getAddress()).toBeTruthy();
      expect(wallet.getAddress().length).toBeGreaterThan(0);
    });

    it('should create wallets with different addresses', () => {
      const wallet1 = SolanaWallet.create();
      const wallet2 = SolanaWallet.create();
      expect(wallet1.getAddress()).not.toBe(wallet2.getAddress());
    });

    it('should accept custom derivation path option', () => {
      const wallet = SolanaWallet.create({ derivationPath: "m/44'/501'/1'/0'" });
      expect(wallet.getDerivationPath()).toBe("m/44'/501'/1'/0'");
    });
  });

  describe('fromSeedPhrase', () => {
    it('should import wallet from valid mnemonic', async () => {
      const mnemonic = await bip39.generateMnemonic();
      const wallet = SolanaWallet.fromSeedPhrase(mnemonic);
      expect(wallet).toBeInstanceOf(SolanaWallet);
      expect(wallet.getAddress()).toBeTruthy();
    });

    it('should reject invalid mnemonic', () => {
      expect(() => {
        SolanaWallet.fromSeedPhrase('invalid mnemonic phrase');
      }).toThrow('Invalid mnemonic phrase');
    });

    it('should use custom derivation path', async () => {
      const mnemonic = await bip39.generateMnemonic();
      const wallet = SolanaWallet.fromSeedPhrase(mnemonic, {
        derivationPath: "m/44'/501'/1'/0'",
      });
      expect(wallet.getDerivationPath()).toBe("m/44'/501'/1'/0'");
    });

    it('should generate same wallet from same mnemonic', async () => {
      const mnemonic = await bip39.generateMnemonic();
      const wallet1 = SolanaWallet.fromSeedPhrase(mnemonic);
      const wallet2 = SolanaWallet.fromSeedPhrase(mnemonic);
      expect(wallet1.getAddress()).toBe(wallet2.getAddress());
    });
  });

  describe('fromPrivateKey', () => {
    it('should import from Uint8Array (32 bytes)', () => {
      const keypair = Keypair.generate();
      const seed = keypair.secretKey.slice(0, 32);
      const wallet = SolanaWallet.fromPrivateKey(seed);
      expect(wallet.getAddress()).toBe(keypair.publicKey.toBase58());
    });

    it('should import from Uint8Array (64 bytes)', () => {
      const keypair = Keypair.generate();
      const wallet = SolanaWallet.fromPrivateKey(keypair.secretKey);
      expect(wallet.getAddress()).toBe(keypair.publicKey.toBase58());
    });

    it('should import from base58 string', () => {
      const keypair = Keypair.generate();
      const base58 = bs58.encode(keypair.secretKey);
      const wallet = SolanaWallet.fromPrivateKey(base58);
      expect(wallet.getAddress()).toBe(keypair.publicKey.toBase58());
    });

    it('should import from base64 string', () => {
      const keypair = Keypair.generate();
      const base64 = Buffer.from(keypair.secretKey).toString('base64');
      const wallet = SolanaWallet.fromPrivateKey(base64);
      expect(wallet.getAddress()).toBe(keypair.publicKey.toBase58());
    });

    it('should import from hex string', () => {
      const keypair = Keypair.generate();
      const hex = Buffer.from(keypair.secretKey).toString('hex');
      const wallet = SolanaWallet.fromPrivateKey(hex);
      expect(wallet.getAddress()).toBe(keypair.publicKey.toBase58());
    });

    it('should reject invalid private key format', () => {
      expect(() => {
        SolanaWallet.fromPrivateKey('invalid-key');
      }).toThrow();
    });
  });

  describe('fromEncrypted', () => {
    it('should import wallet from encrypted data', async () => {
      const wallet = SolanaWallet.create();
      const password = 'test-password-123';
      const encrypted = await wallet.encryptForStorage(password);

      const restored = await SolanaWallet.fromEncrypted(encrypted, password);
      expect(restored.getAddress()).toBe(wallet.getAddress());
    });

    it('should reject wrong password', async () => {
      const wallet = SolanaWallet.create();
      const encrypted = await wallet.encryptForStorage('correct-password');

      await expect(SolanaWallet.fromEncrypted(encrypted, 'wrong-password')).rejects.toThrow();
    });
  });

  describe('getAddress and getPublicKey', () => {
    it('should return valid Solana address', () => {
      const wallet = SolanaWallet.create();
      const address = wallet.getAddress();
      expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/); // Base58 format
    });

    it('should return PublicKey object', () => {
      const wallet = SolanaWallet.create();
      const publicKey = wallet.getPublicKey();
      expect(publicKey).toBeInstanceOf(PublicKey);
      expect(publicKey.toBase58()).toBe(wallet.getAddress());
    });
  });

  describe('signTransaction', () => {
    it('should sign a transaction with recentBlockhash', () => {
      const wallet = SolanaWallet.create();
      const transaction = new Transaction();
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: wallet.getPublicKey(),
          toPubkey: wallet.getPublicKey(),
          lamports: 1000,
        })
      );
      // recentBlockhash is REQUIRED for signing (partialSign will fail without it)
      // In production, get this from: connection.getLatestBlockhash()
      transaction.recentBlockhash = '11111111111111111111111111111111';
      transaction.feePayer = wallet.getPublicKey();

      const signed = wallet.signTransaction(transaction);
      expect(signed.signatures.length).toBeGreaterThan(0);
      // Check that signature exists (can be Uint8Array or SignaturePubkeyPair)
      const firstSig = signed.signatures[0];
      expect(firstSig).toBeDefined();
    });

    it('should throw error if wallet is cleared', () => {
      const wallet = SolanaWallet.create();
      const publicKey = wallet.getPublicKey(); // Get public key before clearing
      wallet.clear();
      const transaction = new Transaction();
      transaction.recentBlockhash = '11111111111111111111111111111111';
      transaction.feePayer = publicKey; // Use the saved public key

      expect(() => {
        wallet.signTransaction(transaction);
      }).toThrow('Wallet has been cleared');
    });
  });

  describe('signMessage', () => {
    it('should sign a message string', () => {
      const wallet = SolanaWallet.create();
      const message = 'Hello, Solana!';
      const signature = wallet.signMessage(message);
      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(64); // Ed25519 signature length
    });

    it('should sign a message Uint8Array', () => {
      const wallet = SolanaWallet.create();
      const message = new TextEncoder().encode('Test message');
      const signature = wallet.signMessage(message);
      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(64);
    });

    it('should return base64 signature', () => {
      const wallet = SolanaWallet.create();
      const signature = wallet.signMessageBase64('test');
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
    });

    it('should return base58 signature', () => {
      const wallet = SolanaWallet.create();
      const signature = wallet.signMessageBase58('test');
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
    });
  });

  describe('verifyMessage', () => {
    it('should verify correct signature', () => {
      const wallet = SolanaWallet.create();
      const message = 'Test message';
      const signature = wallet.signMessage(message);
      const isValid = wallet.verifyMessage(message, signature);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect signature', () => {
      const wallet = SolanaWallet.create();
      const message = 'Test message';
      wallet.signMessage(message);
      const wrongSignature = new Uint8Array(64).fill(0);
      const isValid = wallet.verifyMessage(message, wrongSignature);
      expect(isValid).toBe(false);
    });

    it('should reject signature for different message', () => {
      const wallet = SolanaWallet.create();
      const message1 = 'Message 1';
      const message2 = 'Message 2';
      const signature = wallet.signMessage(message1);
      const isValid = wallet.verifyMessage(message2, signature);
      expect(isValid).toBe(false);
    });
  });

  describe('encryptForStorage', () => {
    it('should encrypt wallet data', async () => {
      const wallet = SolanaWallet.create();
      const encrypted = await wallet.encryptForStorage('password');
      expect(encrypted).toHaveProperty('encrypted');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('salt');
      expect(encrypted.encrypted).toBeTruthy();
    });

    it('should include derivation path in encrypted data', async () => {
      const wallet = SolanaWallet.create({ derivationPath: "m/44'/501'/1'/0'" });
      const encrypted = await wallet.encryptForStorage('password');
      expect(encrypted.derivationPath).toBe("m/44'/501'/1'/0'");
    });
  });

  describe('clear', () => {
    it('should clear wallet and mark as cleared', () => {
      const wallet = SolanaWallet.create();
      expect(wallet.isCleared()).toBe(false);
      wallet.clear();
      expect(wallet.isCleared()).toBe(true);
    });

    it('should prevent operations after clear', () => {
      const wallet = SolanaWallet.create();
      wallet.clear();

      expect(() => wallet.getAddress()).toThrow('Wallet has been cleared');
      expect(() => wallet.signMessage('test')).toThrow('Wallet has been cleared');
    });

    it('should be safe to call clear multiple times', () => {
      const wallet = SolanaWallet.create();
      wallet.clear();
      wallet.clear(); // Should not throw
      expect(wallet.isCleared()).toBe(true);
    });
  });

  describe('getPrivateKey methods', () => {
    it('should return private key as Uint8Array', () => {
      const wallet = SolanaWallet.create();
      const privateKey = wallet.getPrivateKey();
      expect(privateKey).toBeInstanceOf(Uint8Array);
      expect(privateKey.length).toBe(64);
    });

    it('should return private key in different formats', () => {
      const wallet = SolanaWallet.create();
      const base64 = wallet.getPrivateKeyBase64();
      const hex = wallet.getPrivateKeyHex();
      const base58 = wallet.getPrivateKeyBase58();

      expect(typeof base64).toBe('string');
      expect(typeof hex).toBe('string');
      expect(typeof base58).toBe('string');
    });
  });
});
