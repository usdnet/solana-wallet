/**
 * Tests for SolanaWallet
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SolanaWallet } from './wallet';
import { Keypair, Transaction, SystemProgram, PublicKey, Connection } from '@solana/web3.js';
import * as web3 from '@solana/web3.js';
import * as bip39 from 'bip39';
import * as bs58 from 'bs58';
import * as splToken from '@solana/spl-token';

// Mock @solana/web3.js
vi.mock('@solana/web3.js', async () => {
  const actual = await vi.importActual('@solana/web3.js');
  return {
    ...actual,
    sendAndConfirmTransaction: vi.fn(),
  };
});

// Mock @solana/spl-token
vi.mock('@solana/spl-token', async () => {
  const actual = await vi.importActual('@solana/spl-token');
  return {
    ...actual,
    getAssociatedTokenAddress: vi.fn(),
    getAccount: vi.fn(),
  };
});

describe('SolanaWallet', () => {
  describe('generateMnemonic', () => {
    it('should generate a valid 12-word mnemonic by default', () => {
      const mnemonic = SolanaWallet.generateMnemonic();
      expect(bip39.validateMnemonic(mnemonic)).toBe(true);
      expect(mnemonic.split(' ').length).toBe(12);
    });

    it('should generate a 12-word mnemonic with strength 128', () => {
      const mnemonic = SolanaWallet.generateMnemonic(128);
      expect(bip39.validateMnemonic(mnemonic)).toBe(true);
      expect(mnemonic.split(' ').length).toBe(12);
    });

    it('should generate a 24-word mnemonic with strength 256', () => {
      const mnemonic = SolanaWallet.generateMnemonic(256);
      expect(bip39.validateMnemonic(mnemonic)).toBe(true);
      expect(mnemonic.split(' ').length).toBe(24);
    });

    it('should generate different mnemonics each time', () => {
      const mnemonic1 = SolanaWallet.generateMnemonic();
      const mnemonic2 = SolanaWallet.generateMnemonic();
      expect(mnemonic1).not.toBe(mnemonic2);
    });
  });

  describe('createWithMnemonic', () => {
    it('should create wallet with mnemonic', () => {
      const { wallet, mnemonic } = SolanaWallet.createWithMnemonic();
      expect(wallet).toBeInstanceOf(SolanaWallet);
      expect(bip39.validateMnemonic(mnemonic)).toBe(true);
      expect(mnemonic.split(' ').length).toBe(12);
    });

    it('should create wallet that can be restored from the mnemonic', () => {
      const { wallet, mnemonic } = SolanaWallet.createWithMnemonic();
      const address1 = wallet.getAddress();

      const restoredWallet = SolanaWallet.fromSeedPhrase(mnemonic);
      const address2 = restoredWallet.getAddress();

      expect(address1).toBe(address2);
    });

    it('should create 24-word mnemonic with strength 256', () => {
      const { wallet, mnemonic } = SolanaWallet.createWithMnemonic({ strength: 256 });
      expect(bip39.validateMnemonic(mnemonic)).toBe(true);
      expect(mnemonic.split(' ').length).toBe(24);
      expect(wallet).toBeInstanceOf(SolanaWallet);
    });

    it('should accept custom derivation path', () => {
      const { wallet, mnemonic } = SolanaWallet.createWithMnemonic({
        derivationPath: "m/44'/501'/1'/0'",
      });
      expect(wallet).toBeInstanceOf(SolanaWallet);
      expect(bip39.validateMnemonic(mnemonic)).toBe(true);

      const restoredWallet = SolanaWallet.fromSeedPhrase(mnemonic, {
        derivationPath: "m/44'/501'/1'/0'",
      });
      expect(restoredWallet.getAddress()).toBe(wallet.getAddress());
    });

    it('should create different wallets each time', () => {
      const { wallet: wallet1, mnemonic: mnemonic1 } = SolanaWallet.createWithMnemonic();
      const { wallet: wallet2, mnemonic: mnemonic2 } = SolanaWallet.createWithMnemonic();

      expect(mnemonic1).not.toBe(mnemonic2);
      expect(wallet1.getAddress()).not.toBe(wallet2.getAddress());
    });
  });

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

  describe('getBalance', () => {
    it('should get SOL balance', async () => {
      const wallet = SolanaWallet.create();
      const connection = new Connection('https://api.mainnet-beta.solana.com');

      // Mock the getBalance method
      const mockGetBalance = vi.spyOn(connection, 'getBalance').mockResolvedValue(1000000000); // 1 SOL

      const balance = await wallet.getBalance(connection);
      expect(balance).toBe(1);
      expect(mockGetBalance).toHaveBeenCalledWith(wallet.getPublicKey());

      mockGetBalance.mockRestore();
    });
  });

  describe('getTokenBalance', () => {
    let wallet: SolanaWallet;
    let connection: Connection;
    let tokenMint: PublicKey;

    beforeEach(() => {
      wallet = SolanaWallet.create();
      connection = new Connection('https://api.mainnet-beta.solana.com');
      tokenMint = Keypair.generate().publicKey;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return null for non-existent token account', async () => {
      // Mock getAssociatedTokenAddress
      vi.spyOn(splToken, 'getAssociatedTokenAddress').mockResolvedValue(
        Keypair.generate().publicKey
      );

      // Mock getAccount to throw error (account doesn't exist)
      vi.spyOn(splToken, 'getAccount').mockRejectedValue(new Error('Account not found'));

      const balance = await wallet.getTokenBalance(connection, tokenMint);
      expect(balance).toBeNull();
    });

    it('should return token balance for existing account', async () => {
      const associatedTokenAddress = Keypair.generate().publicKey;
      vi.mocked(splToken.getAssociatedTokenAddress).mockResolvedValue(associatedTokenAddress);

      // Mock getAccount to return token account
      const mockTokenAccount = {
        address: associatedTokenAddress,
        mint: tokenMint,
        owner: wallet.getPublicKey(),
        amount: BigInt('1000000000'), // 1 token with 9 decimals
        decimals: 9,
      };
      vi.mocked(splToken.getAccount).mockResolvedValue(mockTokenAccount as any);

      // Mock getParsedAccountInfo for mint info
      vi.spyOn(connection, 'getParsedAccountInfo').mockResolvedValue({
        value: {
          data: {
            parsed: {
              info: {
                decimals: 9,
              },
            },
            program: 'spl-token',
            space: 0,
          } as any,
          executable: false,
          owner: Keypair.generate().publicKey,
          lamports: 0,
        },
        context: { slot: 0 },
      });

      const balance = await wallet.getTokenBalance(connection, tokenMint);
      expect(balance).not.toBeNull();
      expect(balance?.mint).toBe(tokenMint.toBase58());
      expect(balance?.amount).toBe('1000000000');
      expect(balance?.decimals).toBe(9);
      expect(balance?.uiAmount).toBe(1);
    });
  });

  describe('sendSol', () => {
    let wallet: SolanaWallet;
    let connection: Connection;
    let recipient: PublicKey;

    beforeEach(() => {
      wallet = SolanaWallet.create();
      connection = new Connection('https://api.mainnet-beta.solana.com');
      recipient = Keypair.generate().publicKey;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should send SOL transaction', async () => {
      // Mock sendAndConfirmTransaction
      vi.mocked(web3.sendAndConfirmTransaction).mockResolvedValue('test-signature-123' as any);

      const signature = await wallet.sendSol(connection, recipient, 0.1);
      expect(signature).toBe('test-signature-123');
    });

    it('should handle send options', async () => {
      vi.mocked(web3.sendAndConfirmTransaction).mockResolvedValue('test-sig' as any);
      const mockSend = vi.mocked(web3.sendAndConfirmTransaction);

      await wallet.sendSol(connection, recipient, 0.1, {
        skipPreflight: true,
        maxRetries: 3,
      });

      expect(mockSend).toHaveBeenCalled();
      const callArgs = mockSend.mock.calls[0];
      expect(callArgs[3]?.skipPreflight).toBe(true);
      expect(callArgs[3]?.maxRetries).toBe(3);
    });
  });

  describe('sendToken', () => {
    let wallet: SolanaWallet;
    let connection: Connection;
    let tokenMint: PublicKey;
    let recipient: PublicKey;

    beforeEach(() => {
      wallet = SolanaWallet.create();
      connection = new Connection('https://api.mainnet-beta.solana.com');
      tokenMint = Keypair.generate().publicKey;
      recipient = Keypair.generate().publicKey;
    });

    it('should send SPL token transaction', async () => {
      // Mock getAssociatedTokenAddress
      const fromATA = Keypair.generate().publicKey;
      const toATA = Keypair.generate().publicKey;
      vi.mocked(splToken.getAssociatedTokenAddress)
        .mockResolvedValueOnce(fromATA)
        .mockResolvedValueOnce(toATA);

      // Mock getParsedAccountInfo for mint info
      vi.spyOn(connection, 'getParsedAccountInfo').mockResolvedValue({
        value: {
          data: {
            parsed: {
              info: {
                decimals: 9,
              },
            },
            program: 'spl-token',
            space: 0,
          } as any,
          executable: false,
          owner: Keypair.generate().publicKey,
          lamports: 0,
        },
        context: { slot: 0 },
      });

      // Mock sendAndConfirmTransaction
      vi.mocked(web3.sendAndConfirmTransaction).mockResolvedValue('token-tx-signature' as any);

      const signature = await wallet.sendToken(connection, tokenMint, recipient, 100, {
        decimals: 9,
      });
      expect(signature).toBe('token-tx-signature');
      expect(vi.mocked(web3.sendAndConfirmTransaction)).toHaveBeenCalled();
    });

    it('should auto-detect decimals if not provided', async () => {
      const fromATA = Keypair.generate().publicKey;
      const toATA = Keypair.generate().publicKey;
      vi.mocked(splToken.getAssociatedTokenAddress)
        .mockResolvedValueOnce(fromATA)
        .mockResolvedValueOnce(toATA);

      // Mock getParsedAccountInfo for mint info with 6 decimals
      vi.spyOn(connection, 'getParsedAccountInfo').mockResolvedValue({
        value: {
          data: {
            parsed: {
              info: {
                decimals: 6,
              },
            },
            program: 'spl-token',
            space: 0,
          } as any,
          executable: false,
          owner: Keypair.generate().publicKey,
          lamports: 0,
        },
        context: { slot: 0 },
      });

      vi.mocked(web3.sendAndConfirmTransaction).mockResolvedValue('tx-sig' as any);

      await wallet.sendToken(connection, tokenMint, recipient, 100);
      expect(vi.mocked(web3.sendAndConfirmTransaction)).toHaveBeenCalled();
    });
  });

  describe('getTransactionActivity', () => {
    let wallet: SolanaWallet;
    let connection: Connection;

    beforeEach(() => {
      wallet = SolanaWallet.create();
      connection = new Connection('https://api.mainnet-beta.solana.com');
    });

    it('should get transaction activity with SOL transfer', async () => {
      const walletPubkey = wallet.getPublicKey();
      const otherPubkey = Keypair.generate().publicKey;

      // Mock getSignaturesForAddress
      const mockSignatures = vi.spyOn(connection, 'getSignaturesForAddress').mockResolvedValue([
        {
          signature: 'test-sig-1',
          slot: 12345,
          blockTime: 1234567890,
          err: null,
          memo: null,
        },
      ]);

      // Mock getParsedTransaction - SOL send transaction
      const mockTx = vi.spyOn(connection, 'getParsedTransaction').mockResolvedValue({
        meta: {
          preBalances: [1000000000, 0], // wallet has 1 SOL, recipient has 0
          postBalances: [900000000, 100000000], // wallet sends 0.1 SOL
          preTokenBalances: [],
          postTokenBalances: [],
        },
        transaction: {
          message: {
            accountKeys: [
              { pubkey: walletPubkey },
              { pubkey: otherPubkey },
            ],
            instructions: [],
          },
        },
      } as unknown as web3.ParsedTransactionWithMeta);

      const activities = await wallet.getTransactionActivity(connection, { limit: 10 });
      expect(activities).toHaveLength(1);
      expect(activities[0].signature).toBe('test-sig-1');
      expect(activities[0].type).toBe('send');
      expect(activities[0].amount).toBeCloseTo(0.1, 6);

      mockSignatures.mockRestore();
      mockTx.mockRestore();
    });

    it('should get transaction activity with token transfer', async () => {
      const walletPubkey = wallet.getPublicKey();
      const tokenMint = Keypair.generate().publicKey;

      const mockSignatures = vi.spyOn(connection, 'getSignaturesForAddress').mockResolvedValue([
        {
          signature: 'token-tx-sig',
          slot: 12346,
          blockTime: 1234567891,
          err: null,
          memo: null,
        },
      ]);

      // Mock getParsedTransaction - Token transfer
      const mockTx = vi.spyOn(connection, 'getParsedTransaction').mockResolvedValue({
        meta: {
          preBalances: [1000000000],
          postBalances: [1000000000],
          preTokenBalances: [],
          postTokenBalances: [
            {
              accountIndex: 1,
              mint: tokenMint.toBase58(),
              owner: walletPubkey.toBase58(),
              uiTokenAmount: {
                uiAmount: 100,
                decimals: 9,
                amount: '100000000000',
                uiAmountString: '100',
              },
            },
          ],
        },
        transaction: {
          message: {
            accountKeys: [{ pubkey: walletPubkey }],
            instructions: [],
          },
        },
      } as unknown as web3.ParsedTransactionWithMeta);

      const activities = await wallet.getTransactionActivity(connection);
      expect(activities).toHaveLength(1);
      expect(activities[0].type).toBe('receive');
      expect(activities[0].amount).toBe(100);
      expect(activities[0].tokenMint).toBe(tokenMint.toBase58());

      mockSignatures.mockRestore();
      mockTx.mockRestore();
    });

    it('should handle transactions with errors', async () => {
      const mockSignatures = vi.spyOn(connection, 'getSignaturesForAddress').mockResolvedValue([
        {
          signature: 'error-tx',
          slot: 12347,
          blockTime: null,
          err: { code: 1, message: 'Error' },
          memo: null,
        },
      ]);

      const mockTx = vi.spyOn(connection, 'getParsedTransaction').mockResolvedValue(null);

      const activities = await wallet.getTransactionActivity(connection);
      expect(activities).toHaveLength(1);
      expect(activities[0].signature).toBe('error-tx');
      expect(activities[0].type).toBe('other');
      expect(activities[0].err).not.toBeNull();

      mockSignatures.mockRestore();
      mockTx.mockRestore();
    });

    it('should handle limit option', async () => {
      const mockSignatures = vi.spyOn(connection, 'getSignaturesForAddress').mockResolvedValue([]);

      await wallet.getTransactionActivity(connection, { limit: 5 });
      expect(mockSignatures).toHaveBeenCalledWith(
        wallet.getPublicKey(),
        expect.objectContaining({ limit: 5 })
      );

      mockSignatures.mockRestore();
    });
  });
});
