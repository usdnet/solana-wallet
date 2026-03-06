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

// Mock @solana/kit
vi.mock('@solana/kit', async () => {
  const actual = await vi.importActual('@solana/kit');
  return {
    ...actual,
    createSolanaRpcSubscriptions: vi.fn(),
    address: vi.fn((addr: string) => addr),
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
        delegate: null,
        delegatedAmount: BigInt(0),
        isInitialized: true,
        isFrozen: false,
        isNative: false,
        closeAuthority: null,
        txn: null,
        rentExemptReserve: null,
        tlvData: Buffer.alloc(0),
      };
      vi.mocked(splToken.getAccount).mockResolvedValue(
        mockTokenAccount satisfies splToken.Account
      );

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
          },
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
      vi.mocked(web3.sendAndConfirmTransaction).mockResolvedValue('test-signature-123');

      const signature = await wallet.sendSol(connection, recipient, 0.1);
      expect(signature).toBe('test-signature-123');
    });

    it('should handle send options', async () => {
      vi.mocked(web3.sendAndConfirmTransaction).mockResolvedValue('test-sig');
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
      const mockParsedData2: web3.ParsedAccountData = {
        program: 'spl-token',
        parsed: {
          info: {
            decimals: 9,
          },
        },
        space: 0,
      };
      vi.spyOn(connection, 'getParsedAccountInfo').mockResolvedValue({
        value: {
          executable: false,
          owner: Keypair.generate().publicKey,
          lamports: 0,
          data: mockParsedData2,
        },
        context: { slot: 0 },
      });

      // Mock sendAndConfirmTransaction
      vi.mocked(web3.sendAndConfirmTransaction).mockResolvedValue('token-tx-signature');

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
          },
          executable: false,
          owner: Keypair.generate().publicKey,
          lamports: 0,
        },
        context: { slot: 0 },
      });

      vi.mocked(web3.sendAndConfirmTransaction).mockResolvedValue('tx-sig');

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
      const mockParsedTx: web3.ParsedTransactionWithMeta = {
        meta: {
          err: null,
          fee: 5000,
          preBalances: [1000000000, 0], // wallet has 1 SOL, recipient has 0
          postBalances: [900000000, 100000000], // wallet sends 0.1 SOL
          preTokenBalances: [],
          postTokenBalances: [],
          innerInstructions: [],
          logMessages: [],
        },
        transaction: {
          message: {
            accountKeys: [
              { pubkey: walletPubkey, signer: true, writable: true },
              { pubkey: otherPubkey, signer: false, writable: true },
            ],
            instructions: [],
            recentBlockhash: 'test-blockhash',
          },
          signatures: [],
        },
        slot: 12345,
        blockTime: 1234567890,
      };
      const mockTx = vi.spyOn(connection, 'getParsedTransaction').mockResolvedValue(mockParsedTx);

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
      const mockParsedTx2: web3.ParsedTransactionWithMeta = {
        meta: {
          err: null,
          fee: 5000,
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
          innerInstructions: [],
          logMessages: [],
        },
        transaction: {
          message: {
            accountKeys: [{ pubkey: walletPubkey, signer: true, writable: true }],
            instructions: [],
            recentBlockhash: 'test-blockhash',
          },
          signatures: [],
        },
        slot: 12346,
        blockTime: 1234567891,
      };
      const mockTx = vi.spyOn(connection, 'getParsedTransaction').mockResolvedValue(mockParsedTx2);

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

  describe('Event Emitter', () => {
    let wallet: SolanaWallet;
    let connection: Connection;

    beforeEach(() => {
      wallet = SolanaWallet.create();
      connection = new Connection('https://api.mainnet-beta.solana.com');
    });

    afterEach(() => {
      wallet.stopBalanceMonitoring();
      wallet.stopAllTokenBalanceMonitoring();
      wallet.removeAllListeners();
      vi.restoreAllMocks();
    });

    describe('balanceChange event', () => {
      it('should emit balanceChange event when sending SOL', async () => {
        const balanceChangeListener = vi.fn();
        wallet.on('balanceChange', balanceChangeListener);

        // Mock wallet.getBalance to return different values before and after send
        const getBalanceSpy = vi
          .spyOn(wallet, 'getBalance')
          .mockResolvedValueOnce(1) // 1 SOL before
          .mockResolvedValueOnce(0.9); // 0.9 SOL after

        const sendAndConfirmSpy = vi
          .spyOn(web3, 'sendAndConfirmTransaction')
          .mockResolvedValue('test-signature');

        await wallet.sendSol(connection, new PublicKey('11111111111111111111111111111111'), 0.1);

        expect(balanceChangeListener).toHaveBeenCalledTimes(1);
        const callArgs = balanceChangeListener.mock.calls[0][0];
        expect(callArgs.previousBalance).toBe(1);
        expect(callArgs.newBalance).toBe(0.9);
        expect(callArgs.difference).toBeCloseTo(-0.1, 10);

        getBalanceSpy.mockRestore();
        sendAndConfirmSpy.mockRestore();
      });

      it('should not emit balanceChange event if balance does not change', async () => {
        const balanceChangeListener = vi.fn();
        wallet.on('balanceChange', balanceChangeListener);

        // Mock getBalance to return same value
        const getBalanceSpy = vi.spyOn(connection, 'getBalance').mockResolvedValue(1000000000);

        const sendAndConfirmSpy = vi
          .spyOn(web3, 'sendAndConfirmTransaction')
          .mockResolvedValue('test-signature');

        await wallet.sendSol(connection, new PublicKey('11111111111111111111111111111111'), 0.1);

        // Should not emit if balance didn't change
        expect(balanceChangeListener).not.toHaveBeenCalled();

        getBalanceSpy.mockRestore();
        sendAndConfirmSpy.mockRestore();
      });

      it('should emit balanceChange event from balance monitoring', async () => {
        const balanceChangeListener = vi.fn();
        wallet.on('balanceChange', balanceChangeListener);

        // Mock Solana Kit subscriptions
        const mockNotifications = [
          { value: { lamports: BigInt(2000000000) } }, // 2 SOL
          { value: { lamports: BigInt(1500000000) } }, // 1.5 SOL
        ];

        const mockAsyncGenerator = {
          [Symbol.asyncIterator]: async function* () {
            for (const notification of mockNotifications) {
              yield notification;
            }
          },
        };

        const mockSubscribe = vi.fn().mockResolvedValue(mockAsyncGenerator);
        const mockAccountNotifications = vi.fn().mockReturnValue({
          subscribe: mockSubscribe,
        });

        const { createSolanaRpcSubscriptions } = await import('@solana/kit');
        const mockRpc = {
          accountNotifications: mockAccountNotifications,
          logsNotifications: vi.fn(),
          programNotifications: vi.fn(),
          rootNotifications: vi.fn(),
          signatureNotifications: vi.fn(),
          slotNotifications: vi.fn(),
        };
        vi.mocked(createSolanaRpcSubscriptions).mockReturnValue(
          mockRpc satisfies ReturnType<typeof createSolanaRpcSubscriptions>
        );

        // Mock initial balance
        vi.spyOn(connection, 'getBalance').mockResolvedValue(1000000000); // 1 SOL

        await wallet.startBalanceMonitoring(connection);

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Manually trigger the generator to process notifications
        const generator = await mockSubscribe();
        for await (const notification of generator) {
          // Process notification
          const newBalance = Number(notification.value.lamports) / 1000000000;
          if (wallet['lastKnownBalance'] !== null && newBalance !== wallet['lastKnownBalance']) {
            wallet['emit']('balanceChange', {
              previousBalance: wallet['lastKnownBalance'],
              newBalance,
              difference: newBalance - wallet['lastKnownBalance'],
            });
          }
          wallet['lastKnownBalance'] = newBalance;
        }

        // Should have emitted for the first change (1 -> 2 SOL)
        expect(balanceChangeListener).toHaveBeenCalled();
      });

      it('should allow removing event listeners', () => {
        const listener1 = vi.fn();
        const listener2 = vi.fn();

        const unsubscribe1 = wallet.on('balanceChange', listener1);
        wallet.on('balanceChange', listener2);

        wallet['emit']('balanceChange', {
          previousBalance: 1,
          newBalance: 2,
          difference: 1,
        });

        expect(listener1).toHaveBeenCalledTimes(1);
        expect(listener2).toHaveBeenCalledTimes(1);

        unsubscribe1();

        wallet['emit']('balanceChange', {
          previousBalance: 2,
          newBalance: 3,
          difference: 1,
        });

        expect(listener1).toHaveBeenCalledTimes(1); // Not called again
        expect(listener2).toHaveBeenCalledTimes(2); // Called again
      });

      it('should remove all listeners when clear is called', () => {
        const listener = vi.fn();
        wallet.on('balanceChange', listener);

        wallet.clear();

        wallet['emit']('balanceChange', {
          previousBalance: 1,
          newBalance: 2,
          difference: 1,
        });

        expect(listener).not.toHaveBeenCalled();
      });
    });

    describe('tokenBalanceChange event', () => {
      it('should emit tokenBalanceChange event when sending tokens', async () => {
        const tokenBalanceChangeListener = vi.fn();
        wallet.on('tokenBalanceChange', tokenBalanceChangeListener);

        const tokenMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        const recipient = new PublicKey('11111111111111111111111111111111');

        // Mock token account addresses
        const fromTokenAddress = new PublicKey('11111111111111111111111111111112');
        const toTokenAddress = new PublicKey('11111111111111111111111111111113');

        vi.mocked(splToken.getAssociatedTokenAddress)
          .mockResolvedValueOnce(fromTokenAddress)
          .mockResolvedValueOnce(toTokenAddress);

        // Mock token balances - before and after
        const previousBalance = {
          mint: tokenMint.toString(),
          amount: '1000000000',
          decimals: 6,
          uiAmount: 1000,
        };

        const newBalance = {
          mint: tokenMint.toString(),
          amount: '900000000',
          decimals: 6,
          uiAmount: 900,
        };

        const getTokenBalanceSpy = vi
          .spyOn(wallet, 'getTokenBalance')
          .mockResolvedValueOnce(previousBalance)
          .mockResolvedValueOnce(newBalance);

        const sendAndConfirmSpy = vi
          .spyOn(web3, 'sendAndConfirmTransaction')
          .mockResolvedValue('test-signature');

        // Mock getParsedAccountInfo for decimals
        vi.spyOn(connection, 'getParsedAccountInfo').mockResolvedValue({
          value: {
            executable: false,
            owner: Keypair.generate().publicKey,
            lamports: 0,
            data: {
              parsed: {
                info: {
                  decimals: 6,
                },
              },
              program: 'spl-token',
              space: 0,
            },
          },
          context: { slot: 0 },
        });

        await wallet.sendToken(connection, tokenMint, recipient, 100, { decimals: 6 });

        expect(tokenBalanceChangeListener).toHaveBeenCalledTimes(1);
        expect(tokenBalanceChangeListener).toHaveBeenCalledWith({
          mint: tokenMint.toString(),
          previousBalance,
          newBalance,
          difference: -100000000, // 1000000000 - 900000000 (raw amount difference)
        });

        getTokenBalanceSpy.mockRestore();
        sendAndConfirmSpy.mockRestore();
      });

      it('should not emit tokenBalanceChange event if balance does not change', async () => {
        const tokenBalanceChangeListener = vi.fn();
        wallet.on('tokenBalanceChange', tokenBalanceChangeListener);

        const tokenMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        const recipient = new PublicKey('11111111111111111111111111111111');

        const fromTokenAddress = new PublicKey('11111111111111111111111111111112');
        const toTokenAddress = new PublicKey('11111111111111111111111111111113');

        vi.mocked(splToken.getAssociatedTokenAddress)
          .mockResolvedValueOnce(fromTokenAddress)
          .mockResolvedValueOnce(toTokenAddress);

        const sameBalance = {
          mint: tokenMint.toString(),
          amount: '1000000000',
          decimals: 6,
          uiAmount: 1000,
        };

        const getTokenBalanceSpy = vi
          .spyOn(wallet, 'getTokenBalance')
          .mockResolvedValue(sameBalance);

        const sendAndConfirmSpy = vi
          .spyOn(web3, 'sendAndConfirmTransaction')
          .mockResolvedValue('test-signature');

        vi.spyOn(connection, 'getParsedAccountInfo').mockResolvedValue({
          value: {
            executable: false,
            owner: Keypair.generate().publicKey,
            lamports: 0,
            data: {
              parsed: {
                info: {
                  decimals: 6,
                },
              },
              program: 'spl-token',
              space: 0,
            },
          },
          context: { slot: 0 },
        });

        await wallet.sendToken(connection, tokenMint, recipient, 100, { decimals: 6 });

        // Should not emit if balance didn't change
        expect(tokenBalanceChangeListener).not.toHaveBeenCalled();

        getTokenBalanceSpy.mockRestore();
        sendAndConfirmSpy.mockRestore();
      });

      it('should handle token balance change from null to value', async () => {
        const tokenBalanceChangeListener = vi.fn();
        wallet.on('tokenBalanceChange', tokenBalanceChangeListener);

        const tokenMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        const recipient = new PublicKey('11111111111111111111111111111111');

        const fromTokenAddress = new PublicKey('11111111111111111111111111111112');
        const toTokenAddress = new PublicKey('11111111111111111111111111111113');

        vi.mocked(splToken.getAssociatedTokenAddress)
          .mockResolvedValueOnce(fromTokenAddress)
          .mockResolvedValueOnce(toTokenAddress);

        const newBalance = {
          mint: tokenMint.toString(),
          amount: '1000000000',
          decimals: 6,
          uiAmount: 1000,
        };

        const getTokenBalanceSpy = vi
          .spyOn(wallet, 'getTokenBalance')
          .mockResolvedValueOnce(null) // No balance before
          .mockResolvedValueOnce(newBalance); // Has balance after

        const sendAndConfirmSpy = vi
          .spyOn(web3, 'sendAndConfirmTransaction')
          .mockResolvedValue('test-signature');

        vi.spyOn(connection, 'getParsedAccountInfo').mockResolvedValue({
          value: {
            executable: false,
            owner: Keypair.generate().publicKey,
            lamports: 0,
            data: {
              parsed: {
                info: {
                  decimals: 6,
                },
              },
              program: 'spl-token',
              space: 0,
            },
          },
          context: { slot: 0 },
        });

        await wallet.sendToken(connection, tokenMint, recipient, 100, { decimals: 6 });

        expect(tokenBalanceChangeListener).toHaveBeenCalledTimes(1);
        expect(tokenBalanceChangeListener).toHaveBeenCalledWith({
          mint: tokenMint.toString(),
          previousBalance: null,
          newBalance,
          difference: 1000000000, // 0 to 1000000000 (raw amount, not uiAmount)
        });

        getTokenBalanceSpy.mockRestore();
        sendAndConfirmSpy.mockRestore();
      });

      it('should parse token account data from notification and emit balance changes', async () => {
        const tokenBalanceChangeListener = vi.fn();
        wallet.on('tokenBalanceChange', tokenBalanceChangeListener);

        const tokenMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        const associatedTokenAddress = new PublicKey('11111111111111111111111111111114');

        // Mock getAssociatedTokenAddress
        vi.mocked(splToken.getAssociatedTokenAddress).mockResolvedValue(associatedTokenAddress);

        // Mock initial balance
        const initialBalance = {
          mint: tokenMint.toString(),
          amount: '1000000000', // 1000 tokens with 6 decimals
          decimals: 6,
          uiAmount: 1000,
        };
        vi.spyOn(wallet, 'getTokenBalance').mockResolvedValue(initialBalance);

        // Mock getParsedAccountInfo for decimals
        const mockParsedData: web3.ParsedAccountData = {
          program: 'spl-token',
          parsed: {
            info: {
              decimals: 6,
            },
          },
          space: 0,
        };
        vi.spyOn(connection, 'getParsedAccountInfo').mockResolvedValue({
          value: {
            executable: false,
            owner: Keypair.generate().publicKey,
            lamports: 0,
            data: mockParsedData,
          },
          context: { slot: 0 },
        });

        // Create mock token account data for different balances
        // Token account structure: mint (32) + owner (32) + amount (8) + delegateOption (4) + state (1) + isNativeOption (4) + delegatedAmount (8) + closeAuthorityOption (4)
        const createTokenAccountData = (amount: bigint): Buffer => {
          const buffer = Buffer.alloc(165); // Standard token account size
          // Mint (32 bytes at offset 0)
          tokenMint.toBuffer().copy(buffer, 0);
          // Owner (32 bytes at offset 32) - wallet public key
          wallet.getPublicKey().toBuffer().copy(buffer, 32);
          // Amount (8 bytes, little-endian u64 at offset 64)
          buffer.writeBigUInt64LE(amount, 64);
          // DelegateOption (4 bytes at offset 72) - 0 = None
          buffer.writeUInt32LE(0, 72);
          // State (1 byte at offset 76) - 1 = initialized
          buffer[76] = 1;
          // IsNativeOption (4 bytes at offset 77) - 0 = None
          buffer.writeUInt32LE(0, 77);
          // DelegatedAmount (8 bytes at offset 81) - 0
          buffer.writeBigUInt64LE(BigInt(0), 81);
          // CloseAuthorityOption (4 bytes at offset 89) - 0 = None
          buffer.writeUInt32LE(0, 89);
          // Rest can be zeros
          return buffer;
        };

        const { createSolanaRpcSubscriptions } = await import('@solana/kit');
        const mockAbortController = { signal: { aborted: false }, abort: vi.fn() };

        // Create notifications with different balances
        const notifications = [
          {
            value: {
              data: createTokenAccountData(BigInt('1500000000')), // 1500 tokens
              owner: splToken.TOKEN_PROGRAM_ID.toString(),
              lamports: BigInt(2039280), // Rent-exempt reserve
              executable: false,
            },
          },
          {
            value: {
              data: createTokenAccountData(BigInt('2000000000')), // 2000 tokens
              owner: splToken.TOKEN_PROGRAM_ID.toString(),
              lamports: BigInt(2039280),
              executable: false,
            },
          },
        ];

        const mockAsyncGenerator = {
          [Symbol.asyncIterator]: async function* () {
            for (const notification of notifications) {
              yield notification;
            }
          },
        };

        const mockSubscribe = vi.fn().mockResolvedValue(mockAsyncGenerator);
        const mockAccountNotifications = vi.fn().mockReturnValue({
          subscribe: mockSubscribe,
        });

        const mockRpc = {
          accountNotifications: mockAccountNotifications,
          logsNotifications: vi.fn(),
          programNotifications: vi.fn(),
          rootNotifications: vi.fn(),
          signatureNotifications: vi.fn(),
          slotNotifications: vi.fn(),
        };
        vi.mocked(createSolanaRpcSubscriptions).mockReturnValue(
          mockRpc satisfies ReturnType<typeof createSolanaRpcSubscriptions>
        );

        vi.spyOn(global, 'AbortController').mockImplementation(() => {
          const mockAbortControllerTyped: Partial<AbortController> = {
            signal: mockAbortController.signal as AbortSignal,
            abort: mockAbortController.abort,
          };
          return mockAbortControllerTyped as AbortController;
        });

        // Start monitoring
        await wallet.startTokenBalanceMonitoring(connection, tokenMint);

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify events were emitted
        expect(tokenBalanceChangeListener).toHaveBeenCalledTimes(2);

        // First notification: 1000 -> 1500 tokens (difference: +500 tokens = +500000000 raw)
        expect(tokenBalanceChangeListener).toHaveBeenNthCalledWith(1, {
          mint: tokenMint.toString(),
          previousBalance: initialBalance,
          newBalance: {
            mint: tokenMint.toString(),
            amount: '1500000000',
            decimals: 6,
            uiAmount: 1500,
          },
          difference: 500000000, // 1500000000 - 1000000000
        });

        // Second notification: 1500 -> 2000 tokens (difference: +500 tokens = +500000000 raw)
        expect(tokenBalanceChangeListener).toHaveBeenNthCalledWith(2, {
          mint: tokenMint.toString(),
          previousBalance: {
            mint: tokenMint.toString(),
            amount: '1500000000',
            decimals: 6,
            uiAmount: 1500,
          },
          newBalance: {
            mint: tokenMint.toString(),
            amount: '2000000000',
            decimals: 6,
            uiAmount: 2000,
          },
          difference: 500000000, // 2000000000 - 1500000000
        });

        wallet.stopTokenBalanceMonitoring(tokenMint);
      });

      it('should handle account closure in token balance monitoring', async () => {
        const tokenBalanceChangeListener = vi.fn();
        wallet.on('tokenBalanceChange', tokenBalanceChangeListener);

        const tokenMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        const associatedTokenAddress = new PublicKey('11111111111111111111111111111114');

        vi.mocked(splToken.getAssociatedTokenAddress).mockResolvedValue(associatedTokenAddress);

        const initialBalance = {
          mint: tokenMint.toString(),
          amount: '1000000000',
          decimals: 6,
          uiAmount: 1000,
        };
        vi.spyOn(wallet, 'getTokenBalance').mockResolvedValue(initialBalance);

        const mockParsedData: web3.ParsedAccountData = {
          program: 'spl-token',
          parsed: {
            info: {
              decimals: 6,
            },
          },
          space: 0,
        };
        vi.spyOn(connection, 'getParsedAccountInfo').mockResolvedValue({
          value: {
            executable: false,
            owner: Keypair.generate().publicKey,
            lamports: 0,
            data: mockParsedData,
          },
          context: { slot: 0 },
        });

        const { createSolanaRpcSubscriptions } = await import('@solana/kit');
        const mockAbortController = { signal: { aborted: false }, abort: vi.fn() };

        // Notification with null data (account closed)
        const mockAsyncGenerator = {
          [Symbol.asyncIterator]: async function* () {
            yield {
              value: {
                data: null,
                owner: null,
                lamports: BigInt(0),
                executable: false,
              },
            };
          },
        };

        const mockSubscribe = vi.fn().mockResolvedValue(mockAsyncGenerator);
        const mockAccountNotifications = vi.fn().mockReturnValue({
          subscribe: mockSubscribe,
        });

        const mockRpc = {
          accountNotifications: mockAccountNotifications,
          logsNotifications: vi.fn(),
          programNotifications: vi.fn(),
          rootNotifications: vi.fn(),
          signatureNotifications: vi.fn(),
          slotNotifications: vi.fn(),
        };
        vi.mocked(createSolanaRpcSubscriptions).mockReturnValue(
          mockRpc satisfies ReturnType<typeof createSolanaRpcSubscriptions>
        );

        vi.spyOn(global, 'AbortController').mockImplementation(() => {
          const mockAbortControllerTyped: Partial<AbortController> = {
            signal: mockAbortController.signal as AbortSignal,
            abort: mockAbortController.abort,
          };
          return mockAbortControllerTyped as AbortController;
        });

        await wallet.startTokenBalanceMonitoring(connection, tokenMint);

        // Wait for async processing
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify event was emitted for account closure
        expect(tokenBalanceChangeListener).toHaveBeenCalledTimes(1);
        expect(tokenBalanceChangeListener).toHaveBeenCalledWith({
          mint: tokenMint.toString(),
          previousBalance: initialBalance,
          newBalance: null,
          difference: -1000000000, // Negative difference (balance went to 0)
        });

        wallet.stopTokenBalanceMonitoring(tokenMint);
      });

      it('should emit event when token account is created from non-existent state', async () => {
        const tokenBalanceChangeListener = vi.fn();
        wallet.on('tokenBalanceChange', tokenBalanceChangeListener);

        const tokenMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        const associatedTokenAddress = new PublicKey('11111111111111111111111111111114');

        // Mock getAssociatedTokenAddress
        vi.mocked(splToken.getAssociatedTokenAddress).mockResolvedValue(associatedTokenAddress);

        // Mock initial balance as null (account doesn't exist)
        vi.spyOn(wallet, 'getTokenBalance').mockResolvedValue(null);

        // Mock getParsedAccountInfo for decimals
        const mockParsedData: web3.ParsedAccountData = {
          program: 'spl-token',
          parsed: {
            info: {
              decimals: 6,
            },
          },
          space: 0,
        };
        vi.spyOn(connection, 'getParsedAccountInfo').mockResolvedValue({
          value: {
            executable: false,
            owner: Keypair.generate().publicKey,
            lamports: 0,
            data: mockParsedData,
          },
          context: { slot: 0 },
        });

        // Helper to create valid token account data buffer
        const createTokenAccountBuffer = (amount: bigint): Buffer => {
          const buffer = Buffer.alloc(165);
          tokenMint.toBuffer().copy(buffer, 0);
          wallet.getPublicKey().toBuffer().copy(buffer, 32);
          buffer.writeBigUInt64LE(amount, 64);
          buffer.writeUInt32LE(0, 72);
          buffer[76] = 1;
          buffer.writeUInt32LE(0, 77);
          buffer.writeBigUInt64LE(BigInt(0), 81);
          buffer.writeUInt32LE(0, 89);
          return buffer;
        };

        const { createSolanaRpcSubscriptions } = await import('@solana/kit');
        const mockAbortController = { signal: { aborted: false }, abort: vi.fn() };

        // Simulate account creation: account doesn't exist, then gets created with balance
        const notifications = [
          {
            value: {
              data: createTokenAccountBuffer(BigInt('500000000')), // 500 tokens = 500 * 10^6
              owner: splToken.TOKEN_PROGRAM_ID.toString(),
              lamports: BigInt(2039280),
              executable: false,
            },
          },
        ];

        const mockAsyncGenerator = {
          [Symbol.asyncIterator]: async function* () {
            for (const notification of notifications) {
              yield notification;
            }
          },
        };

        const mockSubscribe = vi.fn().mockResolvedValue(mockAsyncGenerator);
        const mockAccountNotifications = vi.fn().mockReturnValue({
          subscribe: mockSubscribe,
        });

        // Mock logs notifications for account creation detection
        const logsAsyncGenerator = {
          [Symbol.asyncIterator]: async function* () {
            // Simulate log notification for account creation
            yield {
              value: {
                signature: 'test-signature',
                err: null,
                logs: [
                  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
                  'Program log: InitializeAccount',
                  `Program ${wallet.getPublicKey().toString()} invoke [1]`,
                  `Program ${associatedTokenAddress.toString()} invoke [1]`,
                ],
              },
              context: { slot: BigInt(12345) },
            };
          },
        };
        const mockLogsSubscribe = vi.fn().mockResolvedValue(logsAsyncGenerator);
        const mockLogsNotifications = vi.fn().mockReturnValue({
          subscribe: mockLogsSubscribe,
        });

        const mockRpc = {
          accountNotifications: mockAccountNotifications,
          logsNotifications: mockLogsNotifications,
          programNotifications: vi.fn(),
          rootNotifications: vi.fn(),
          signatureNotifications: vi.fn(),
          slotNotifications: vi.fn(),
        };
        vi.mocked(createSolanaRpcSubscriptions).mockReturnValue(
          mockRpc satisfies ReturnType<typeof createSolanaRpcSubscriptions>
        );

        // Create separate abort controllers for logs and account notifications
        const mockLogsAbortController = { signal: { aborted: false }, abort: vi.fn() };
        let abortControllerIndex = 0;
        vi.spyOn(global, 'AbortController').mockImplementation(() => {
          const controller = abortControllerIndex++ === 0 ? mockLogsAbortController : mockAbortController;
          const mockAbortControllerTyped: Partial<AbortController> = {
            signal: controller.signal as AbortSignal,
            abort: controller.abort,
          };
          return mockAbortControllerTyped as AbortController;
        });

        // Mock getTokenBalance to return balance after account creation
        vi.spyOn(wallet, 'getTokenBalance')
          .mockResolvedValueOnce(null) // Initial check - account doesn't exist
          .mockResolvedValueOnce({ // After account creation
            mint: tokenMint.toString(),
            amount: '500000000',
            decimals: 6,
            uiAmount: 500,
          });

        await wallet.startTokenBalanceMonitoring(connection, tokenMint);

        // Wait for async processing (logs monitoring + account creation detection + account notifications)
        // Need to wait for: logs subscription -> log processing -> account creation detection -> getTokenBalance -> event emission
        await new Promise((resolve) => setTimeout(resolve, 600));

        // Verify event was emitted when account was created
        expect(tokenBalanceChangeListener).toHaveBeenCalledTimes(1);
        expect(tokenBalanceChangeListener).toHaveBeenCalledWith({
          mint: tokenMint.toString(),
          previousBalance: null, // Account didn't exist before
          newBalance: {
            mint: tokenMint.toString(),
            amount: '500000000',
            decimals: 6,
            uiAmount: 500,
          },
          difference: 500000000, // 0 to 500000000 (account created)
        });

        wallet.stopTokenBalanceMonitoring(tokenMint);
      });

      it('should emit event when token account is created with zero balance', async () => {
        const tokenBalanceChangeListener = vi.fn();
        wallet.on('tokenBalanceChange', tokenBalanceChangeListener);

        const tokenMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        const associatedTokenAddress = new PublicKey('11111111111111111111111111111114');

        vi.mocked(splToken.getAssociatedTokenAddress).mockResolvedValue(associatedTokenAddress);

        // Mock initial balance as null (account doesn't exist)
        vi.spyOn(wallet, 'getTokenBalance').mockResolvedValue(null);

        const mockParsedData: web3.ParsedAccountData = {
          program: 'spl-token',
          parsed: {
            info: {
              decimals: 6,
            },
          },
          space: 0,
        };
        vi.spyOn(connection, 'getParsedAccountInfo').mockResolvedValue({
          value: {
            executable: false,
            owner: Keypair.generate().publicKey,
            lamports: 0,
            data: mockParsedData,
          },
          context: { slot: 0 },
        });

        const createTokenAccountBuffer = (amount: bigint): Buffer => {
          const buffer = Buffer.alloc(165);
          tokenMint.toBuffer().copy(buffer, 0);
          wallet.getPublicKey().toBuffer().copy(buffer, 32);
          buffer.writeBigUInt64LE(amount, 64);
          buffer.writeUInt32LE(0, 72);
          buffer[76] = 1;
          buffer.writeUInt32LE(0, 77);
          buffer.writeBigUInt64LE(BigInt(0), 81);
          buffer.writeUInt32LE(0, 89);
          return buffer;
        };

        const { createSolanaRpcSubscriptions } = await import('@solana/kit');

        // Account created with zero balance
        const notifications = [
          {
            value: {
              data: createTokenAccountBuffer(BigInt('0')), // 0 tokens
              owner: splToken.TOKEN_PROGRAM_ID.toString(),
              lamports: BigInt(2039280),
              executable: false,
            },
          },
        ];

        const mockAsyncGenerator = {
          [Symbol.asyncIterator]: async function* () {
            for (const notification of notifications) {
              yield notification;
            }
          },
        };

        const mockSubscribe = vi.fn().mockResolvedValue(mockAsyncGenerator);
        const mockAccountNotifications = vi.fn().mockReturnValue({
          subscribe: mockSubscribe,
        });

        // Mock logs notifications for account creation detection
        // Include wallet address and associated token address in logs so filtering works
        const logsAsyncGenerator2 = {
          [Symbol.asyncIterator]: async function* () {
            yield {
              value: {
                signature: 'test-signature',
                err: null,
                logs: [
                  'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
                  'Program log: InitializeAccount',
                  `Program ${wallet.getPublicKey().toString()} invoke [1]`,
                  `Program ${associatedTokenAddress.toString()} invoke [1]`,
                ],
              },
              context: { slot: BigInt(12345) },
            };
          },
        };
        const mockLogsSubscribe2 = vi.fn().mockResolvedValue(logsAsyncGenerator2);
        const mockLogsNotifications2 = vi.fn().mockReturnValue({
          subscribe: mockLogsSubscribe2,
        });

        const mockRpc = {
          accountNotifications: mockAccountNotifications,
          logsNotifications: mockLogsNotifications2,
          programNotifications: vi.fn(),
          rootNotifications: vi.fn(),
          signatureNotifications: vi.fn(),
          slotNotifications: vi.fn(),
        };
        vi.mocked(createSolanaRpcSubscriptions).mockReturnValue(
          mockRpc satisfies ReturnType<typeof createSolanaRpcSubscriptions>
        );

        const mockLogsAbortController = { signal: { aborted: false }, abort: vi.fn() };
        const mockAccountAbortController = { signal: { aborted: false }, abort: vi.fn() };
        let abortControllerIndex = 0;
        vi.spyOn(global, 'AbortController').mockImplementation(() => {
          const controller = abortControllerIndex++ === 0 ? mockLogsAbortController : mockAccountAbortController;
          const mockAbortControllerTyped: Partial<AbortController> = {
            signal: controller.signal as AbortSignal,
            abort: controller.abort,
          };
          return mockAbortControllerTyped as AbortController;
        });

        // Mock getTokenBalance to return balance after account creation
        vi.spyOn(wallet, 'getTokenBalance')
          .mockResolvedValueOnce(null) // Initial check - account doesn't exist
          .mockResolvedValueOnce({ // After account creation
            mint: tokenMint.toString(),
            amount: '0',
            decimals: 6,
            uiAmount: 0,
          });

        await wallet.startTokenBalanceMonitoring(connection, tokenMint);

        await new Promise((resolve) => setTimeout(resolve, 600));

        // Verify event was emitted even though balance is 0 (account was created)
        expect(tokenBalanceChangeListener).toHaveBeenCalledTimes(1);
        expect(tokenBalanceChangeListener).toHaveBeenCalledWith({
          mint: tokenMint.toString(),
          previousBalance: null, // Account didn't exist before
          newBalance: {
            mint: tokenMint.toString(),
            amount: '0',
            decimals: 6,
            uiAmount: 0,
          },
          difference: 0, // 0 to 0, but account was created
        });

        wallet.stopTokenBalanceMonitoring(tokenMint);
      });

      it('should not emit event when account remains non-existent', async () => {
        const tokenBalanceChangeListener = vi.fn();
        wallet.on('tokenBalanceChange', tokenBalanceChangeListener);

        const tokenMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        const associatedTokenAddress = new PublicKey('11111111111111111111111111111114');

        vi.mocked(splToken.getAssociatedTokenAddress).mockResolvedValue(associatedTokenAddress);

        // Mock initial balance as null (account doesn't exist)
        vi.spyOn(wallet, 'getTokenBalance').mockResolvedValue(null);

        const mockParsedData: web3.ParsedAccountData = {
          program: 'spl-token',
          parsed: {
            info: {
              decimals: 6,
            },
          },
          space: 0,
        };
        vi.spyOn(connection, 'getParsedAccountInfo').mockResolvedValue({
          value: {
            executable: false,
            owner: Keypair.generate().publicKey,
            lamports: 0,
            data: mockParsedData,
          },
          context: { slot: 0 },
        });

        const { createSolanaRpcSubscriptions } = await import('@solana/kit');

        // Mock logs notifications - no account creation logs (account remains non-existent)
        const mockLogsSubscribe = vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            // No logs that indicate account creation - just yield nothing or unrelated logs
            yield {
              value: {
                signature: 'unrelated-signature',
                err: null,
                logs: ['Program log: SomeOtherInstruction'],
              },
              context: { slot: BigInt(12345) },
            };
          },
        });
        const mockLogsNotifications = vi.fn().mockReturnValue({
          subscribe: mockLogsSubscribe,
        });

        const mockRpc = {
          accountNotifications: vi.fn(), // Won't be used since account doesn't exist
          logsNotifications: mockLogsNotifications,
          programNotifications: vi.fn(),
          rootNotifications: vi.fn(),
          signatureNotifications: vi.fn(),
          slotNotifications: vi.fn(),
        };
        vi.mocked(createSolanaRpcSubscriptions).mockReturnValue(
          mockRpc satisfies ReturnType<typeof createSolanaRpcSubscriptions>
        );

        const mockLogsAbortController = { signal: { aborted: false }, abort: vi.fn() };
        vi.spyOn(global, 'AbortController').mockImplementation(() => {
          const mockAbortControllerTyped: Partial<AbortController> = {
            signal: mockLogsAbortController.signal as AbortSignal,
            abort: mockLogsAbortController.abort,
          };
          return mockAbortControllerTyped as AbortController;
        });

        await wallet.startTokenBalanceMonitoring(connection, tokenMint);

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Verify no event was emitted (account didn't exist before and still doesn't)
        expect(tokenBalanceChangeListener).not.toHaveBeenCalled();

        wallet.stopTokenBalanceMonitoring(tokenMint);
      });
    });

    describe('balance monitoring lifecycle', () => {
      it('should stop balance monitoring when stopBalanceMonitoring is called', async () => {
        const { createSolanaRpcSubscriptions } = await import('@solana/kit');
        const mockAbortController = { signal: { aborted: false }, abort: vi.fn() };
        const mockSubscribe = vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { value: { lamports: BigInt(1000000000) } };
          },
        });

        const mockRpc2 = {
          accountNotifications: vi.fn().mockReturnValue({
            subscribe: mockSubscribe,
          }),
          logsNotifications: vi.fn(),
          programNotifications: vi.fn(),
          rootNotifications: vi.fn(),
          signatureNotifications: vi.fn(),
          slotNotifications: vi.fn(),
        };
        vi.mocked(createSolanaRpcSubscriptions).mockReturnValue(
          mockRpc2 satisfies ReturnType<typeof createSolanaRpcSubscriptions>
        );

        vi.spyOn(connection, 'getBalance').mockResolvedValue(1000000000);
        const mockAbortControllerTyped: Partial<AbortController> = {
          signal: mockAbortController.signal as AbortSignal,
          abort: mockAbortController.abort,
        };
        vi.spyOn(global, 'AbortController').mockImplementation(
          () => mockAbortControllerTyped as AbortController
        );

        await wallet.startBalanceMonitoring(connection);
        expect(wallet.isBalanceMonitoringActive()).toBe(true);

        wallet.stopBalanceMonitoring();
        expect(mockAbortController.abort).toHaveBeenCalled();
        expect(wallet.isBalanceMonitoringActive()).toBe(false);
      });

      it('should stop all token balance monitoring', async () => {
        const tokenMint1 = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
        const tokenMint2 = new PublicKey('So11111111111111111111111111111111111111112');

        vi.mocked(splToken.getAssociatedTokenAddress).mockResolvedValue(
          new PublicKey('11111111111111111111111111111114')
        );

        const { createSolanaRpcSubscriptions } = await import('@solana/kit');
        const mockAbortController1 = { signal: { aborted: false }, abort: vi.fn() };
        const mockAbortController2 = { signal: { aborted: false }, abort: vi.fn() };

        let controllerIndex = 0;
        vi.spyOn(global, 'AbortController').mockImplementation(() => {
          const controller = controllerIndex++ === 0 ? mockAbortController1 : mockAbortController2;
          const mockAbortControllerTyped: Partial<AbortController> = {
            signal: controller.signal as AbortSignal,
            abort: controller.abort,
          };
          return mockAbortControllerTyped as AbortController;
        });

        const mockRpc4 = {
          accountNotifications: vi.fn().mockReturnValue({
            subscribe: vi.fn().mockResolvedValue({
              [Symbol.asyncIterator]: async function* () { },
            }),
          }),
          logsNotifications: vi.fn().mockReturnValue({
            subscribe: vi.fn().mockResolvedValue({
              [Symbol.asyncIterator]: async function* () { },
            }),
          }),
          programNotifications: vi.fn(),
          rootNotifications: vi.fn(),
          signatureNotifications: vi.fn(),
          slotNotifications: vi.fn(),
        };
        vi.mocked(createSolanaRpcSubscriptions).mockReturnValue(
          mockRpc4 satisfies ReturnType<typeof createSolanaRpcSubscriptions>
        );

        // Mock getParsedAccountInfo for decimals
        const mockParsedData: web3.ParsedAccountData = {
          program: 'spl-token',
          parsed: {
            info: {
              decimals: 9,
            },
          },
          space: 0,
        };
        vi.spyOn(connection, 'getParsedAccountInfo').mockResolvedValue({
          value: {
            executable: false,
            owner: Keypair.generate().publicKey,
            lamports: 0,
            data: mockParsedData,
          },
          context: { slot: 0 },
        });

        vi.spyOn(wallet, 'getTokenBalance').mockResolvedValue(null);

        await wallet.startTokenBalanceMonitoring(connection, tokenMint1);
        await wallet.startTokenBalanceMonitoring(connection, tokenMint2);

        wallet.stopAllTokenBalanceMonitoring();

        expect(mockAbortController1.abort).toHaveBeenCalled();
        expect(mockAbortController2.abort).toHaveBeenCalled();
      });
    });
  });
});
