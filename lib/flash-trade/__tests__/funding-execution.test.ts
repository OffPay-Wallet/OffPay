import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';

import { FLASH_V2_PROGRAM_ID } from '@/lib/flash-trade/constants';
import {
  sendAndConfirmFlashFundingTransaction,
  simulateFlashFundingTransaction,
  verifyFlashFundingTransaction,
  verifySignedFlashFundingTransaction,
  type FlashFundingExecutionApi,
} from '@/lib/flash-trade/funding-execution';

const FLASH_PROGRAM = new PublicKey(FLASH_V2_PROGRAM_ID);
const MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const DELEGATION_PROGRAM = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const RAW_AMOUNT = 1_000_000n;

function instructionData(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}

function amountData(amount: bigint): Buffer {
  const data = Buffer.alloc(16);
  instructionData('ceb7b208c4571b96').copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  return data;
}

function setupInstruction(params: {
  wallet: PublicKey;
  data: Buffer;
  payerFirst?: boolean;
  programId?: PublicKey;
}): TransactionInstruction {
  const owner = { pubkey: params.wallet, isSigner: false, isWritable: false };
  const payer = { pubkey: params.wallet, isSigner: true, isWritable: true };
  const filler = () => ({
    pubkey: Keypair.generate().publicKey,
    isSigner: false,
    isWritable: true,
  });
  const keys = params.payerFirst
    ? [
        payer,
        owner,
        filler(),
        filler(),
        filler(),
        filler(),
        filler(),
        { pubkey: FLASH_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: FLASH_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: DELEGATION_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ]
    : [
        owner,
        payer,
        filler(),
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ];
  return new TransactionInstruction({
    programId: params.programId ?? FLASH_PROGRAM,
    keys,
    data: params.data,
  });
}

function depositInstruction(wallet: PublicKey, amount = RAW_AMOUNT): TransactionInstruction {
  const filler = () => ({
    pubkey: Keypair.generate().publicKey,
    isSigner: false,
    isWritable: true,
  });
  return new TransactionInstruction({
    programId: FLASH_PROGRAM,
    keys: [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: wallet, isSigner: false, isWritable: false },
      filler(),
      filler(),
      { pubkey: MINT, isSigner: false, isWritable: false },
      filler(),
      filler(),
      filler(),
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      filler(),
      { pubkey: FLASH_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: amountData(amount),
  });
}

function buildTransaction(params: {
  wallet: PublicKey;
  includeSetup?: boolean;
  duplicateDeposit?: boolean;
  foreignSetupProgram?: boolean;
  blockhash?: string;
}): VersionedTransaction {
  const instructions: TransactionInstruction[] = [];
  if (params.includeSetup !== false) {
    instructions.push(
      setupInstruction({
        wallet: params.wallet,
        data: instructionData('bbef8051ae465eec08080804'),
        programId: params.foreignSetupProgram ? SystemProgram.programId : FLASH_PROGRAM,
      }),
      setupInstruction({
        wallet: params.wallet,
        data: instructionData('5570ce941213059308'),
      }),
      setupInstruction({
        wallet: params.wallet,
        data: instructionData('c477ba2bc5ea0fb2'),
        payerFirst: true,
      }),
    );
  }
  instructions.push(depositInstruction(params.wallet));
  if (params.duplicateDeposit) instructions.push(depositInstruction(params.wallet));

  const message = new TransactionMessage({
    payerKey: params.wallet,
    recentBlockhash: params.blockhash ?? Keypair.generate().publicKey.toBase58(),
    instructions,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function toBase64(transaction: VersionedTransaction): string {
  return Buffer.from(transaction.serialize()).toString('base64');
}

function api(overrides: Partial<FlashFundingExecutionApi> = {}): FlashFundingExecutionApi {
  return {
    getAccounts: jest.fn(async () => ({ network: 'mainnet' as const, accounts: [] })),
    simulate: jest.fn(async () => ({ success: true, error: null, unitsConsumed: 100_000 })),
    broadcast: jest.fn(async () => ({ signature: 'flash-funding-signature' })),
    getSignatureStatuses: jest.fn(async () => ({
      statuses: [
        {
          slot: 1,
          confirmations: 1,
          err: null,
          confirmationStatus: 'confirmed' as const,
        },
      ],
    })),
    ...overrides,
  };
}

describe('Flash V2 funding transaction verification', () => {
  it('accepts the official one-shot setup and exact deposit intent', async () => {
    const wallet = Keypair.generate();
    const transaction = buildTransaction({ wallet: wallet.publicKey });

    const verified = await verifyFlashFundingTransaction({
      transactionBase64: toBase64(transaction),
      intent: {
        walletAddress: wallet.publicKey.toBase58(),
        expectedMint: MINT.toBase58(),
        expectedRawAmount: RAW_AMOUNT.toString(),
      },
      api: api(),
    });

    expect(verified.setupInstructionNames).toEqual([
      'init_basket',
      'init_user_deposit_ledger',
      'delegate_basket',
    ]);
  });

  it('accepts an already-initialized account transaction containing only one deposit', async () => {
    const wallet = Keypair.generate();
    const transaction = buildTransaction({ wallet: wallet.publicKey, includeSetup: false });

    await expect(
      verifyFlashFundingTransaction({
        transactionBase64: toBase64(transaction),
        intent: {
          walletAddress: wallet.publicKey.toBase58(),
          expectedMint: MINT.toBase58(),
          expectedRawAmount: RAW_AMOUNT.toString(),
        },
        api: api(),
      }),
    ).resolves.toMatchObject({ setupInstructionNames: [] });
  });

  it('rejects amount, mint, duplicate-deposit, and foreign-program substitutions', async () => {
    const wallet = Keypair.generate();
    const intent = {
      walletAddress: wallet.publicKey.toBase58(),
      expectedMint: MINT.toBase58(),
      expectedRawAmount: RAW_AMOUNT.toString(),
    };

    await expect(
      verifyFlashFundingTransaction({
        transactionBase64: toBase64(buildTransaction({ wallet: wallet.publicKey })),
        intent: { ...intent, expectedRawAmount: '999999' },
        api: api(),
      }),
    ).rejects.toThrow('amount does not match');
    await expect(
      verifyFlashFundingTransaction({
        transactionBase64: toBase64(buildTransaction({ wallet: wallet.publicKey })),
        intent: { ...intent, expectedMint: Keypair.generate().publicKey.toBase58() },
        api: api(),
      }),
    ).rejects.toThrow('unexpected mint');
    await expect(
      verifyFlashFundingTransaction({
        transactionBase64: toBase64(
          buildTransaction({ wallet: wallet.publicKey, duplicateDeposit: true }),
        ),
        intent,
        api: api(),
      }),
    ).rejects.toThrow('repeats deposit_direct');
    await expect(
      verifyFlashFundingTransaction({
        transactionBase64: toBase64(
          buildTransaction({ wallet: wallet.publicKey, foreignSetupProgram: true }),
        ),
        intent,
        api: api(),
      }),
    ).rejects.toThrow('non-Flash program');
  });

  it('requires a valid wallet signature and an unchanged V0 message', async () => {
    const wallet = Keypair.generate();
    const unsigned = buildTransaction({ wallet: wallet.publicKey });
    const signed = VersionedTransaction.deserialize(unsigned.serialize());
    signed.sign([wallet]);
    const intent = {
      walletAddress: wallet.publicKey.toBase58(),
      expectedMint: MINT.toBase58(),
      expectedRawAmount: RAW_AMOUNT.toString(),
    };

    await expect(
      verifySignedFlashFundingTransaction({
        unsignedTransactionBase64: toBase64(unsigned),
        signedTransactionBase64: toBase64(signed),
        intent,
        api: api(),
      }),
    ).resolves.toBeDefined();

    const changed = buildTransaction({
      wallet: wallet.publicKey,
      blockhash: Keypair.generate().publicKey.toBase58(),
    });
    changed.sign([wallet]);
    await expect(
      verifySignedFlashFundingTransaction({
        unsignedTransactionBase64: toBase64(unsigned),
        signedTransactionBase64: toBase64(changed),
        intent,
        api: api(),
      }),
    ).rejects.toThrow('changed the Flash funding transaction message');
  });
});

describe('Flash V2 funding base-chain execution', () => {
  it('fails closed when unsigned preflight simulation fails', async () => {
    await expect(
      simulateFlashFundingTransaction({
        unsignedTransactionBase64: 'unsigned',
        api: api({
          simulate: jest.fn(async () => ({
            success: false,
            error: 'insufficient funds',
            unitsConsumed: null,
          })),
        }),
      }),
    ).rejects.toThrow('insufficient funds');
  });

  it('broadcasts once and waits for confirmed status', async () => {
    const statuses = jest
      .fn()
      .mockResolvedValueOnce({
        statuses: [{ slot: 1, confirmations: null, err: null, confirmationStatus: 'processed' }],
      })
      .mockResolvedValueOnce({
        statuses: [{ slot: 2, confirmations: 1, err: null, confirmationStatus: 'confirmed' }],
      });
    const executionApi = api({ getSignatureStatuses: statuses });
    const wait = jest.fn(async () => undefined);

    await expect(
      sendAndConfirmFlashFundingTransaction({
        signedTransactionBase64: 'signed',
        api: executionApi,
        wait,
      }),
    ).resolves.toMatchObject({ signature: 'flash-funding-signature' });
    expect(executionApi.broadcast).toHaveBeenCalledTimes(1);
    expect(statuses).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});
