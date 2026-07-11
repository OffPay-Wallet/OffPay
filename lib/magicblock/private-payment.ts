import { Buffer } from 'buffer';

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

import {
  broadcastRawTransaction,
  getRpcAccounts,
  getRpcFeeForMessage,
  getRpcMinimumBalanceForRentExemption,
  initializePrivatePaymentMint,
  preparePrivateSend,
  executePrivateSend,
  OffpayApiError,
} from '@/lib/api/offpay-api-client';
import {
  instructionHasTokenTransferAmount,
  resolveMessageAccountKeys,
  verifyExpectedRecipient,
  verifyRequestedTokenMint,
} from '@/lib/magicblock/instruction-inspector';
import {
  assertInstructionIndexesAreSafe,
  assertRange,
  decodeBase64Transaction,
  normalizeAtomicAmount,
  parseSerializedTransaction,
  readShortVec,
  u64FromLittleEndian,
} from '@/lib/magicblock/tx-parsing';
import { enqueuePendingPaymentBackup } from '@/lib/payments/pending-backup-queue';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  deriveAssociatedTokenAddress,
} from '@/lib/crypto/solana-token-accounts';
import { signSerializedTransactionForWallet } from '@/lib/crypto/solana-transaction-signing';
import { mark, measure } from '@/lib/perf/perf-marks';
import {
  PRIVATE_PAYMENT_LAYER_LABEL,
  STABLECOIN_ONLY_PAYMENT_MESSAGE,
  isSupportedStablecoinToken,
} from '@/lib/policy/stablecoin-policy';

import type {
  OffpayNetwork,
  PreparedTransaction,
  PrivateInitMintResponse,
  PrivateSendResponse,
  PrivateSendRequest,
  RpcAccountRecord,
} from '@/types/offpay-api';

const NATIVE_SOL_SYSTEM_MINT = '11111111111111111111111111111111';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const SPL_TOKEN_ACCOUNT_SPACE = 165;
const SYSTEM_INSTRUCTION_CREATE_ACCOUNT = 0;
const SYSTEM_INSTRUCTION_TRANSFER = 2;
const SYSTEM_INSTRUCTION_CREATE_ACCOUNT_WITH_SEED = 3;
const SYSTEM_INSTRUCTION_TRANSFER_WITH_SEED = 11;
const ASSOCIATED_TOKEN_CREATE_INSTRUCTION = 0;
const ASSOCIATED_TOKEN_CREATE_IDEMPOTENT_INSTRUCTION = 1;
const MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID = 'SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2';
const MAGICBLOCK_DELEGATION_PROGRAM_ID = 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh';
const MAGICBLOCK_PRIVATE_TRANSFER_INSTRUCTION = 0x19;
const MAGICBLOCK_MAX_INIT_RENT_LAMPORTS = 50_000_000n;
const TOKEN_PROGRAM_IDS = new Set([SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]);

function deriveProgramAddress(seeds: readonly Uint8Array[], programId: string): string {
  return PublicKey.findProgramAddressSync(
    seeds.map((seed) => Buffer.from(seed)),
    new PublicKey(programId),
  )[0].toBase58();
}

function publicKeySeed(address: string): Uint8Array {
  return new PublicKey(address).toBytes();
}

function delegationAccounts(delegatedAccount: string): {
  buffer: string;
  record: string;
  metadata: string;
} {
  const accountSeed = publicKeySeed(delegatedAccount);
  return {
    buffer: deriveProgramAddress(
      [Buffer.from('buffer', 'utf8'), accountSeed],
      MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
    ),
    record: deriveProgramAddress(
      [Buffer.from('delegation', 'utf8'), accountSeed],
      MAGICBLOCK_DELEGATION_PROGRAM_ID,
    ),
    metadata: deriveProgramAddress(
      [Buffer.from('delegation-metadata', 'utf8'), accountSeed],
      MAGICBLOCK_DELEGATION_PROGRAM_ID,
    ),
  };
}

export interface PrivatePaymentVerification {
  requiredSigners: string[];
  instructionCount: number;
  verifiedAmount: boolean;
  verifiedRecipient: boolean;
  recipientVerification: 'explicit' | 'provider-request-bound';
  providerRequestBound: boolean;
  verifiedMint: boolean;
}

export type PrivatePaymentSubmitResult =
  | {
      status: 'submitted';
      signature: string;
      initSignature: string | null;
      verification: PrivatePaymentVerification;
    }
  | {
      status: 'queued';
      txId: string;
      uploaded: boolean;
      reason: string;
      initSignature: string | null;
      verification: PrivatePaymentVerification;
    };

export interface SubmitPrivatePaymentParams extends PrivateSendRequest {
  walletId?: string | null;
  preparedPlan?: PreparedPrivatePaymentPlan | null;
}

export interface PreparedPrivatePaymentPlan {
  walletAddress: string;
  recipient: string;
  mint: string;
  amount: string;
  network: OffpayNetwork;
  intentId: string;
  expiresAt: number;
  unsignedTransaction: string;
  transaction: PreparedTransaction | null;
  verification: PrivatePaymentVerification;
  feeLamports: number | null;
  tokenFeeRaw: string;
  solFeePayer: string | null;
  includesMintInitialization: boolean;
  preparedAt: number;
}

function assertPrivatePaymentInputs(params: {
  walletAddress: string;
  recipient: string;
  mint: string;
  amount: string;
  network: OffpayNetwork;
}): bigint {
  if (!isValidSolanaAddress(params.walletAddress)) {
    throw new Error('Unlock a valid Solana wallet before sending a private payment.');
  }

  if (!isValidSolanaAddress(params.recipient)) {
    throw new Error('Enter a valid Solana recipient address.');
  }

  if (!isValidSolanaAddress(params.mint)) {
    throw new Error('Enter a valid Solana token mint address.');
  }

  if (params.mint === NATIVE_SOL_SYSTEM_MINT) {
    throw new Error('Native SOL is not supported for private payments. Use a token mint instead.');
  }

  if (!isSupportedStablecoinToken({ network: params.network, token: params.mint })) {
    throw new Error(
      `${STABLECOIN_ONLY_PAYMENT_MESSAGE} ${PRIVATE_PAYMENT_LAYER_LABEL} does not protect this token.`,
    );
  }

  return normalizeAtomicAmount(params.amount);
}

function getInstructionProgram(params: {
  instruction: ReturnType<typeof parseSerializedTransaction>['instructions'][number];
  accountKeys: string[];
}): string {
  const program = params.accountKeys[params.instruction.programIdIndex];
  if (program == null) {
    throw new Error('MagicBlock transaction references an unresolved program.');
  }
  return program;
}

function getInstructionAccount(params: {
  instruction: ReturnType<typeof parseSerializedTransaction>['instructions'][number];
  accountKeys: string[];
  position: number;
}): string {
  const accountIndex = params.instruction.accountIndexes[params.position];
  const account = accountIndex == null ? null : params.accountKeys[accountIndex];
  if (account == null) {
    throw new Error('MagicBlock transaction contains a malformed instruction account list.');
  }
  return account;
}

function instructionDataEquals(data: Uint8Array, expected: readonly number[]): boolean {
  return data.length === expected.length && expected.every((byte, index) => data[index] === byte);
}

function assertMagicBlockProviderEnvelope(params: {
  unsignedTransaction: string;
  transaction: PreparedTransaction;
  parsed: ReturnType<typeof parseSerializedTransaction>;
  walletAddress: string;
  expectedKind: 'transfer' | 'initializeMint';
  expectedVersion: 'v0' | 'legacy';
  expectedInstructionCount: number;
}): void {
  const { transaction, parsed } = params;

  if (transaction.transactionBase64.trim() !== params.unsignedTransaction.trim()) {
    throw new Error('Private payment response metadata does not match the unsigned transaction.');
  }
  if (
    transaction.kind !== params.expectedKind ||
    transaction.version !== params.expectedVersion ||
    transaction.sendTo !== 'base' ||
    transaction.instructionCount !== params.expectedInstructionCount ||
    transaction.requiredSigners.length !== 1 ||
    transaction.requiredSigners[0] !== params.walletAddress ||
    transaction.validator == null ||
    !isValidSolanaAddress(transaction.validator) ||
    transaction.recentBlockhash !== parsed.recentBlockhash ||
    transaction.lastValidBlockHeight == null ||
    !Number.isSafeInteger(transaction.lastValidBlockHeight) ||
    transaction.lastValidBlockHeight <= 0
  ) {
    throw new Error('MagicBlock transaction metadata is incomplete or inconsistent.');
  }
  if (
    (params.expectedVersion === 'v0' && parsed.messageVersion !== 0) ||
    (params.expectedVersion === 'legacy' && parsed.messageVersion !== 'legacy')
  ) {
    throw new Error('MagicBlock transaction version does not match its metadata.');
  }
  if (
    parsed.signatureCount !== 1 ||
    parsed.requiredSignerCount !== 1 ||
    parsed.requiredSigners.length !== 1 ||
    parsed.requiredSigners[0] !== params.walletAddress ||
    parsed.accountKeys[0] !== params.walletAddress
  ) {
    throw new Error('MagicBlock transaction must use only the active wallet as signer and fee payer.');
  }
}

function assertMagicBlockPrivateTransferLayout(params: {
  parsed: ReturnType<typeof parseSerializedTransaction>;
  accountKeys: string[];
  transaction: PreparedTransaction;
  walletAddress: string;
  mint: string;
  amount: bigint;
}): void {
  assertMagicBlockProviderEnvelope({
    unsignedTransaction: params.transaction.transactionBase64,
    transaction: params.transaction,
    parsed: params.parsed,
    walletAddress: params.walletAddress,
    expectedKind: 'transfer',
    expectedVersion: 'v0',
    expectedInstructionCount: 4,
  });
  const fees = params.transaction.fees;
  if (
    fees == null ||
    !/^\d+$/.test(fees.lamports) ||
    !/^\d+$/.test(fees.tokens) ||
    BigInt(fees.tokens) !== params.amount / 1_000n ||
    BigInt(fees.lamports) > MAGICBLOCK_MAX_INIT_RENT_LAMPORTS
  ) {
    throw new Error('MagicBlock private transfer fee metadata is missing or unexpected.');
  }

  const [ataInstruction, initializeInstruction, delegateInstruction, transferInstruction] =
    params.parsed.instructions;
  if (
    ataInstruction == null ||
    initializeInstruction == null ||
    delegateInstruction == null ||
    transferInstruction == null
  ) {
    throw new Error('MagicBlock private transfer instruction sequence is incomplete.');
  }

  const programs = params.parsed.instructions.map((instruction) =>
    getInstructionProgram({ instruction, accountKeys: params.accountKeys }),
  );
  if (
    programs[0] !== ASSOCIATED_TOKEN_PROGRAM_ID ||
    programs.slice(1).some((program) => program !== MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID)
  ) {
    throw new Error('MagicBlock private transfer invokes an unexpected program.');
  }

  if (
    ataInstruction.accountIndexes.length !== 6 ||
    !instructionDataEquals(ataInstruction.data, [ASSOCIATED_TOKEN_CREATE_IDEMPOTENT_INSTRUCTION])
  ) {
    throw new Error('MagicBlock private transfer contains a non-canonical token-account setup.');
  }
  const tokenProgram = getInstructionAccount({
    instruction: ataInstruction,
    accountKeys: params.accountKeys,
    position: 5,
  });
  if (!TOKEN_PROGRAM_IDS.has(tokenProgram)) {
    throw new Error('MagicBlock private transfer uses an unsupported token program.');
  }
  const walletTokenAccount = deriveAssociatedTokenAddress({
    owner: params.walletAddress,
    mint: params.mint,
    tokenProgramId: tokenProgram,
  });
  if (
    getInstructionAccount({ instruction: ataInstruction, accountKeys: params.accountKeys, position: 0 }) !==
      params.walletAddress ||
    getInstructionAccount({ instruction: ataInstruction, accountKeys: params.accountKeys, position: 1 }) !==
      walletTokenAccount ||
    getInstructionAccount({ instruction: ataInstruction, accountKeys: params.accountKeys, position: 2 }) !==
      params.walletAddress ||
    getInstructionAccount({ instruction: ataInstruction, accountKeys: params.accountKeys, position: 3 }) !==
      params.mint ||
    getInstructionAccount({ instruction: ataInstruction, accountKeys: params.accountKeys, position: 4 }) !==
      SYSTEM_PROGRAM_ID
  ) {
    throw new Error('MagicBlock private transfer token-account setup does not match the request.');
  }

  if (
    initializeInstruction.accountIndexes.length !== 5 ||
    !instructionDataEquals(initializeInstruction.data, [0]) ||
    getInstructionAccount({ instruction: initializeInstruction, accountKeys: params.accountKeys, position: 1 }) !==
      params.walletAddress ||
    getInstructionAccount({ instruction: initializeInstruction, accountKeys: params.accountKeys, position: 2 }) !==
      params.walletAddress ||
    getInstructionAccount({ instruction: initializeInstruction, accountKeys: params.accountKeys, position: 3 }) !==
      params.mint ||
    getInstructionAccount({ instruction: initializeInstruction, accountKeys: params.accountKeys, position: 4 }) !==
      SYSTEM_PROGRAM_ID
  ) {
    throw new Error('MagicBlock private transfer initialization is not canonical.');
  }
  const encryptionAccount = getInstructionAccount({
    instruction: initializeInstruction,
    accountKeys: params.accountKeys,
    position: 0,
  });
  const expectedEncryptionAccount = deriveProgramAddress(
    [publicKeySeed(params.walletAddress), publicKeySeed(params.mint)],
    MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
  );
  if (encryptionAccount !== expectedEncryptionAccount) {
    throw new Error('MagicBlock private transfer initialization uses an unexpected ephemeral account.');
  }
  const validatorBytes = bs58.decode(params.transaction.validator!);
  const encryptionDelegation = delegationAccounts(encryptionAccount);

  if (
    delegateInstruction.accountIndexes.length !== 8 ||
    delegateInstruction.data.length !== 33 ||
    delegateInstruction.data[0] !== 4 ||
    !delegateInstruction.data
      .subarray(1, 33)
      .every((byte, index) => byte === validatorBytes[index]) ||
    getInstructionAccount({ instruction: delegateInstruction, accountKeys: params.accountKeys, position: 0 }) !==
      params.walletAddress ||
    getInstructionAccount({ instruction: delegateInstruction, accountKeys: params.accountKeys, position: 1 }) !==
      encryptionAccount ||
    getInstructionAccount({ instruction: delegateInstruction, accountKeys: params.accountKeys, position: 2 }) !==
      MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID ||
    getInstructionAccount({ instruction: delegateInstruction, accountKeys: params.accountKeys, position: 3 }) !==
      encryptionDelegation.buffer ||
    getInstructionAccount({ instruction: delegateInstruction, accountKeys: params.accountKeys, position: 4 }) !==
      encryptionDelegation.record ||
    getInstructionAccount({ instruction: delegateInstruction, accountKeys: params.accountKeys, position: 5 }) !==
      encryptionDelegation.metadata ||
    getInstructionAccount({ instruction: delegateInstruction, accountKeys: params.accountKeys, position: 6 }) !==
      MAGICBLOCK_DELEGATION_PROGRAM_ID ||
    getInstructionAccount({ instruction: delegateInstruction, accountKeys: params.accountKeys, position: 7 }) !==
      SYSTEM_PROGRAM_ID
  ) {
    throw new Error('MagicBlock private transfer delegation is not canonical.');
  }

  const shuttleId = u32FromLittleEndian(transferInstruction.data, 1);
  if (shuttleId == null) {
    throw new Error('MagicBlock private transfer is missing its shuttle identifier.');
  }
  const shuttleIdSeed = Buffer.alloc(4);
  shuttleIdSeed.writeUInt32LE(shuttleId, 0);
  const shuttleMetadata = deriveProgramAddress(
    [publicKeySeed(params.walletAddress), publicKeySeed(params.mint), shuttleIdSeed],
    MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
  );
  const shuttleAccount = deriveProgramAddress(
    [publicKeySeed(shuttleMetadata), publicKeySeed(params.mint)],
    MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
  );
  const shuttleWalletTokenAccount = deriveAssociatedTokenAddress({
    owner: shuttleMetadata,
    mint: params.mint,
    tokenProgramId: tokenProgram,
  });
  const shuttleDelegation = delegationAccounts(shuttleAccount);
  const rentPda = deriveProgramAddress(
    [Buffer.from('rent', 'utf8')],
    MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
  );
  const globalVault = deriveProgramAddress(
    [publicKeySeed(params.mint)],
    MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
  );
  const globalVaultTokenAccount = deriveAssociatedTokenAddress({
    owner: globalVault,
    mint: params.mint,
    tokenProgramId: tokenProgram,
  });
  const transferQueue = deriveProgramAddress(
    [Buffer.from('queue', 'utf8'), publicKeySeed(params.mint), validatorBytes],
    MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
  );

  if (
    transferInstruction.accountIndexes.length !== 19 ||
    transferInstruction.data.length !== 196 ||
    transferInstruction.data[0] !== MAGICBLOCK_PRIVATE_TRANSFER_INSTRUCTION ||
    u64FromLittleEndian(transferInstruction.data, 5) !== params.amount ||
    transferInstruction.data[13] !== 1 ||
    transferInstruction.data[94] !== 1 ||
    !transferInstruction.data
      .subarray(95, 127)
      .every((byte, index) => byte === validatorBytes[index]) ||
    transferInstruction.data[127] !== transferInstruction.data.length - 128 ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 0 }) !==
      params.walletAddress ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 1 }) !==
      rentPda ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 2 }) !==
      shuttleMetadata ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 3 }) !==
      shuttleAccount ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 4 }) !==
      shuttleWalletTokenAccount ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 5 }) !==
      params.walletAddress ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 6 }) !==
      MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 7 }) !==
      shuttleDelegation.buffer ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 8 }) !==
      shuttleDelegation.record ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 9 }) !==
      shuttleDelegation.metadata ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 10 }) !==
      MAGICBLOCK_DELEGATION_PROGRAM_ID ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 11 }) !==
      ASSOCIATED_TOKEN_PROGRAM_ID ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 12 }) !==
      SYSTEM_PROGRAM_ID ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 13 }) !==
      params.mint ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 14 }) !==
      tokenProgram ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 15 }) !==
      globalVault ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 16 }) !==
      walletTokenAccount ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 17 }) !==
      globalVaultTokenAccount ||
    getInstructionAccount({ instruction: transferInstruction, accountKeys: params.accountKeys, position: 18 }) !==
      transferQueue
  ) {
    throw new Error('MagicBlock private transfer does not match the confirmed mint and amount.');
  }
}

export async function verifyPrivatePaymentUnsignedTransaction(params: {
  unsignedTransaction: string;
  walletAddress: string;
  recipient: string;
  mint: string;
  amount: string;
  network: OffpayNetwork;
  allowHiddenPrivateRecipient?: boolean;
  privateRouteTransaction?: PreparedTransaction | null;
}): Promise<PrivatePaymentVerification> {
  const startedAt = mark();
  try {
    const amount = assertPrivatePaymentInputs(params);
    assertUnsignedSignatureSlotsAreEmpty(params.unsignedTransaction);
    const parsed = parseSerializedTransaction(params.unsignedTransaction);
    const accountKeys = await resolveMessageAccountKeys(parsed, params.network);
    assertInstructionIndexesAreSafe(parsed, accountKeys.length);

    if (
      parsed.signatureCount !== 1 ||
      parsed.requiredSignerCount !== 1 ||
      parsed.requiredSigners[0] !== params.walletAddress ||
      parsed.accountKeys[0] !== params.walletAddress
    ) {
      throw new Error('Private payment transaction must use only the active wallet as signer and fee payer.');
    }

    const recipientIsExplicit = verifyExpectedRecipient({
      parsed,
      accountKeys,
      recipient: params.recipient,
      mint: params.mint,
      amount,
    });
    const providerRequestBound = params.allowHiddenPrivateRecipient === true;
    if (providerRequestBound) {
      const transaction = params.privateRouteTransaction;
      if (transaction == null) {
        throw new Error('MagicBlock private transfer metadata is required before signing.');
      }
      if (transaction.transactionBase64.trim() !== params.unsignedTransaction.trim()) {
        throw new Error('Private payment response metadata does not match the unsigned transaction.');
      }
      assertMagicBlockPrivateTransferLayout({
        parsed,
        accountKeys,
        transaction,
        walletAddress: params.walletAddress,
        mint: params.mint,
        amount,
      });
    } else if (!recipientIsExplicit) {
      throw new Error('Private payment transaction does not send tokens to the intended recipient.');
    }

    const verifiedMint = providerRequestBound
      ? true
      : await verifyRequestedTokenMint({
          parsed,
          accountKeys,
          mint: params.mint,
          amount,
          network: params.network,
        });
    if (!verifiedMint) throw new Error('Private payment transaction does not use the requested token mint.');

    const verifiedAmount = providerRequestBound
      ? true
      : parsed.instructions.some((instruction) =>
          instructionHasTokenTransferAmount({ instruction, accountKeys, amount }),
        );

    if (!verifiedAmount) {
      throw new Error('Private payment transaction does not transfer the requested amount.');
    }

    return {
      requiredSigners: parsed.requiredSigners,
      instructionCount: parsed.instructions.length,
      verifiedAmount,
      verifiedRecipient: recipientIsExplicit,
      recipientVerification: recipientIsExplicit ? 'explicit' : 'provider-request-bound',
      providerRequestBound,
      verifiedMint,
    };
  } finally {
    measure('magicblock.private.verify', startedAt, { network: params.network });
  }
}

async function verifyMintInitTransaction(params: {
  unsignedTransaction: string;
  walletAddress: string;
  mint: string;
  network: OffpayNetwork;
  transaction: PreparedTransaction | null;
}): Promise<void> {
  if (params.transaction == null) {
    throw new Error('MagicBlock mint initialization metadata is required before signing.');
  }
  const parsed = parseSerializedTransaction(params.unsignedTransaction);
  const accountKeys = await resolveMessageAccountKeys(parsed, params.network);
  assertInstructionIndexesAreSafe(parsed, accountKeys.length);
  assertMagicBlockProviderEnvelope({
    unsignedTransaction: params.unsignedTransaction,
    transaction: params.transaction,
    parsed,
    walletAddress: params.walletAddress,
    expectedKind: 'initializeMint',
    expectedVersion: 'legacy',
    expectedInstructionCount: 7,
  });

  const expectedPrograms = [
    MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
    MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
    MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID,
  ];
  const actualPrograms = parsed.instructions.map((instruction) =>
    getInstructionProgram({ instruction, accountKeys }),
  );
  if (actualPrograms.some((program, index) => program !== expectedPrograms[index])) {
    throw new Error('MagicBlock mint initialization invokes an unexpected program.');
  }

  const [queueInstruction, rentInstruction, rentTransfer, delegateQueue, initializeAta, ataCreate, delegateAta] =
    parsed.instructions;
  if (
    queueInstruction == null ||
    rentInstruction == null ||
    rentTransfer == null ||
    delegateQueue == null ||
    initializeAta == null ||
    ataCreate == null ||
    delegateAta == null
  ) {
    throw new Error('MagicBlock mint initialization instruction sequence is incomplete.');
  }
  const transferQueue = params.transaction.transferQueue;
  const rentPda = params.transaction.rentPda;
  const validator = params.transaction.validator;
  if (
    transferQueue == null ||
    rentPda == null ||
    validator == null ||
    !isValidSolanaAddress(transferQueue) ||
    !isValidSolanaAddress(rentPda)
  ) {
    throw new Error('MagicBlock mint initialization route accounts are missing.');
  }

  if (
    queueInstruction.accountIndexes.length !== 16 ||
    !instructionDataEquals(queueInstruction.data, [0x0c]) ||
    getInstructionAccount({ instruction: queueInstruction, accountKeys, position: 0 }) !== params.walletAddress ||
    getInstructionAccount({ instruction: queueInstruction, accountKeys, position: 1 }) !== transferQueue ||
    getInstructionAccount({ instruction: queueInstruction, accountKeys, position: 3 }) !== params.mint ||
    getInstructionAccount({ instruction: queueInstruction, accountKeys, position: 4 }) !== validator ||
    getInstructionAccount({ instruction: queueInstruction, accountKeys, position: 5 }) !== SYSTEM_PROGRAM_ID ||
    !TOKEN_PROGRAM_IDS.has(getInstructionAccount({ instruction: queueInstruction, accountKeys, position: 9 })) ||
    getInstructionAccount({ instruction: queueInstruction, accountKeys, position: 10 }) !== ASSOCIATED_TOKEN_PROGRAM_ID ||
    getInstructionAccount({ instruction: queueInstruction, accountKeys, position: 11 }) !== MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID ||
    getInstructionAccount({ instruction: queueInstruction, accountKeys, position: 15 }) !== MAGICBLOCK_DELEGATION_PROGRAM_ID
  ) {
    throw new Error('MagicBlock transfer-queue initialization is not canonical.');
  }
  const tokenProgram = getInstructionAccount({ instruction: queueInstruction, accountKeys, position: 9 });

  if (
    rentInstruction.accountIndexes.length !== 3 ||
    !instructionDataEquals(rentInstruction.data, [0x17]) ||
    getInstructionAccount({ instruction: rentInstruction, accountKeys, position: 0 }) !== params.walletAddress ||
    getInstructionAccount({ instruction: rentInstruction, accountKeys, position: 1 }) !== rentPda ||
    getInstructionAccount({ instruction: rentInstruction, accountKeys, position: 2 }) !== SYSTEM_PROGRAM_ID ||
    rentTransfer.accountIndexes.length !== 2 ||
    rentTransfer.data.length !== 12 ||
    u32FromLittleEndian(rentTransfer.data, 0) !== SYSTEM_INSTRUCTION_TRANSFER ||
    getInstructionAccount({ instruction: rentTransfer, accountKeys, position: 0 }) !== params.walletAddress ||
    getInstructionAccount({ instruction: rentTransfer, accountKeys, position: 1 }) !== rentPda
  ) {
    throw new Error('MagicBlock mint initialization rent transfer is not canonical.');
  }
  const rentLamports = u64FromLittleEndian(rentTransfer.data, 4);
  if (rentLamports == null || rentLamports <= 0n || rentLamports > MAGICBLOCK_MAX_INIT_RENT_LAMPORTS) {
    throw new Error('MagicBlock mint initialization rent exceeds the safety limit.');
  }

  if (
    delegateQueue.accountIndexes.length !== 9 ||
    !instructionDataEquals(delegateQueue.data, [0x13]) ||
    getInstructionAccount({ instruction: delegateQueue, accountKeys, position: 0 }) !== params.walletAddress ||
    getInstructionAccount({ instruction: delegateQueue, accountKeys, position: 1 }) !== transferQueue ||
    getInstructionAccount({ instruction: delegateQueue, accountKeys, position: 2 }) !== params.mint ||
    getInstructionAccount({ instruction: delegateQueue, accountKeys, position: 3 }) !== MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID ||
    getInstructionAccount({ instruction: delegateQueue, accountKeys, position: 7 }) !== MAGICBLOCK_DELEGATION_PROGRAM_ID ||
    getInstructionAccount({ instruction: delegateQueue, accountKeys, position: 8 }) !== SYSTEM_PROGRAM_ID
  ) {
    throw new Error('MagicBlock transfer-queue delegation is not canonical.');
  }

  const privateAtaOwner = getInstructionAccount({ instruction: initializeAta, accountKeys, position: 0 });
  const privateAta = deriveAssociatedTokenAddress({ owner: privateAtaOwner, mint: params.mint, tokenProgramId: tokenProgram });
  if (
    initializeAta.accountIndexes.length !== 8 ||
    !instructionDataEquals(initializeAta.data, [1]) ||
    getInstructionAccount({ instruction: initializeAta, accountKeys, position: 2 }) !== params.mint ||
    getInstructionAccount({ instruction: initializeAta, accountKeys, position: 5 }) !== tokenProgram ||
    getInstructionAccount({ instruction: initializeAta, accountKeys, position: 6 }) !== ASSOCIATED_TOKEN_PROGRAM_ID ||
    getInstructionAccount({ instruction: initializeAta, accountKeys, position: 7 }) !== SYSTEM_PROGRAM_ID ||
    ataCreate.accountIndexes.length !== 6 ||
    !instructionDataEquals(ataCreate.data, [ASSOCIATED_TOKEN_CREATE_IDEMPOTENT_INSTRUCTION]) ||
    getInstructionAccount({ instruction: ataCreate, accountKeys, position: 0 }) !== params.walletAddress ||
    getInstructionAccount({ instruction: ataCreate, accountKeys, position: 1 }) !== privateAta ||
    getInstructionAccount({ instruction: ataCreate, accountKeys, position: 2 }) !== privateAtaOwner ||
    getInstructionAccount({ instruction: ataCreate, accountKeys, position: 3 }) !== params.mint ||
    getInstructionAccount({ instruction: ataCreate, accountKeys, position: 4 }) !== SYSTEM_PROGRAM_ID ||
    getInstructionAccount({ instruction: ataCreate, accountKeys, position: 5 }) !== tokenProgram
  ) {
    throw new Error('MagicBlock private token-account initialization is not canonical.');
  }

  if (
    delegateAta.accountIndexes.length !== 8 ||
    delegateAta.data.length !== 33 ||
    delegateAta.data[0] !== 4 ||
    getInstructionAccount({ instruction: delegateAta, accountKeys, position: 0 }) !== params.walletAddress ||
    getInstructionAccount({ instruction: delegateAta, accountKeys, position: 2 }) !== MAGICBLOCK_PRIVATE_SPL_PROGRAM_ID ||
    getInstructionAccount({ instruction: delegateAta, accountKeys, position: 6 }) !== MAGICBLOCK_DELEGATION_PROGRAM_ID ||
    getInstructionAccount({ instruction: delegateAta, accountKeys, position: 7 }) !== SYSTEM_PROGRAM_ID
  ) {
    throw new Error('MagicBlock private token-account delegation is not canonical.');
  }
}

function resolveInitTransactionBase64(response: PrivateInitMintResponse): string | null {
  return response.unsignedTransaction ?? response.transaction?.transactionBase64 ?? null;
}

function resolvePrivateSendTransaction(response: PrivateSendResponse): {
  intentId: string;
  expiresAt: number;
  unsignedTransaction: string;
  transaction: PreparedTransaction | null;
} {
  const unsignedTransaction =
    response.unsignedTransaction ?? response.transaction?.transactionBase64 ?? null;

  if (unsignedTransaction == null || unsignedTransaction.trim().length === 0) {
    throw new Error('Private payment response did not include an unsigned transaction.');
  }
  if (
    typeof response.intentId !== 'string' ||
    response.intentId.trim().length === 0 ||
    !Number.isSafeInteger(response.expiresAt) ||
    response.expiresAt <= Date.now()
  ) {
    throw new Error('Private payment response did not include a valid execution intent.');
  }

  return {
    intentId: response.intentId,
    expiresAt: response.expiresAt,
    unsignedTransaction,
    transaction: response.transaction ?? null,
  };
}

function extractMessageBase64FromSerializedTransaction(transactionBase64: string): string {
  const transaction = decodeBase64Transaction(transactionBase64);
  const signatureCount = readShortVec(transaction, 0);
  const messageOffset = signatureCount.offset + signatureCount.value * 64;

  assertRange(transaction, signatureCount.offset, signatureCount.value * 64, 'signatures');
  assertRange(transaction, messageOffset, transaction.length - messageOffset, 'message');

  return Buffer.from(transaction.subarray(messageOffset)).toString('base64');
}

function assertUnsignedSignatureSlotsAreEmpty(transactionBase64: string): void {
  const transaction = decodeBase64Transaction(transactionBase64);
  const signatureCount = readShortVec(transaction, 0);
  const signatureLength = signatureCount.value * 64;
  assertRange(transaction, signatureCount.offset, signatureLength, 'signatures');
  if (
    transaction
      .subarray(signatureCount.offset, signatureCount.offset + signatureLength)
      .some((byte) => byte !== 0)
  ) {
    throw new Error('MagicBlock returned an unexpectedly pre-signed wallet transaction.');
  }
}

export function verifyPrivatePaymentSignedTransaction(params: {
  unsignedTransaction: string;
  signedTransaction: string;
  walletAddress: string;
}): void {
  const unsignedMessage = extractMessageBase64FromSerializedTransaction(params.unsignedTransaction);
  const signedMessage = extractMessageBase64FromSerializedTransaction(params.signedTransaction);
  if (signedMessage !== unsignedMessage) {
    throw new Error('Wallet signer changed the confirmed private payment transaction.');
  }

  const transaction = decodeBase64Transaction(params.signedTransaction);
  const signatureCount = readShortVec(transaction, 0);
  if (signatureCount.value !== 1) {
    throw new Error('Signed private payment must contain exactly one wallet signature.');
  }
  assertRange(transaction, signatureCount.offset, 64, 'wallet signature');
  const signature = transaction.subarray(signatureCount.offset, signatureCount.offset + 64);
  const messageOffset = signatureCount.offset + 64;
  const message = transaction.subarray(messageOffset);
  const publicKey = bs58.decode(params.walletAddress);
  if (
    signature.every((byte) => byte === 0) ||
    publicKey.length !== 32 ||
    !ed25519.verify(signature, message, publicKey)
  ) {
    throw new Error('Signed private payment does not contain a valid active-wallet signature.');
  }
}

function u32FromLittleEndian(data: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > data.length) return null;

  return (
    (data[offset] ?? 0) +
    (data[offset + 1] ?? 0) * 0x100 +
    (data[offset + 2] ?? 0) * 0x1_0000 +
    (data[offset + 3] ?? 0) * 0x1_000000
  );
}

function safeLamportsToNumber(value: bigint): number | null {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function accountExists(record: RpcAccountRecord | null | undefined): boolean {
  return record != null && record.owner != null && record.lamports != null;
}

function readCreateAccountWithSeedLamports(data: Uint8Array): bigint | null {
  const seedLength = u64FromLittleEndian(data, 36);
  if (seedLength == null || seedLength > BigInt(Number.MAX_SAFE_INTEGER)) return null;

  const lamportsOffset = 44 + Number(seedLength);
  return u64FromLittleEndian(data, lamportsOffset);
}

function getWalletFundedSystemLamports(params: {
  instruction: ReturnType<typeof parseSerializedTransaction>['instructions'][number];
  accountKeys: string[];
  walletAddress: string;
}): bigint {
  const programId = params.accountKeys[params.instruction.programIdIndex];
  if (programId !== SYSTEM_PROGRAM_ID) return 0n;

  const fundingAccountIndex = params.instruction.accountIndexes[0];
  if (fundingAccountIndex == null) return 0n;

  const fundingAccount = params.accountKeys[fundingAccountIndex] ?? null;
  if (fundingAccount !== params.walletAddress) return 0n;

  const instructionType = u32FromLittleEndian(params.instruction.data, 0);
  if (instructionType == null) return 0n;

  if (
    instructionType === SYSTEM_INSTRUCTION_CREATE_ACCOUNT ||
    instructionType === SYSTEM_INSTRUCTION_TRANSFER ||
    instructionType === SYSTEM_INSTRUCTION_TRANSFER_WITH_SEED
  ) {
    return u64FromLittleEndian(params.instruction.data, 4) ?? 0n;
  }

  if (instructionType === SYSTEM_INSTRUCTION_CREATE_ACCOUNT_WITH_SEED) {
    return readCreateAccountWithSeedLamports(params.instruction.data) ?? 0n;
  }

  return 0n;
}

function collectWalletPaidAssociatedTokenCreates(params: {
  parsed: ReturnType<typeof parseSerializedTransaction>;
  accountKeys: string[];
  walletAddress: string;
}): string[] {
  const accounts = new Set<string>();

  for (const instruction of params.parsed.instructions) {
    const programId = params.accountKeys[instruction.programIdIndex];
    if (programId !== ASSOCIATED_TOKEN_PROGRAM_ID) continue;

    const instructionType =
      instruction.data.length === 0
        ? ASSOCIATED_TOKEN_CREATE_INSTRUCTION
        : (instruction.data[0] ?? -1);
    if (
      instructionType !== ASSOCIATED_TOKEN_CREATE_INSTRUCTION &&
      instructionType !== ASSOCIATED_TOKEN_CREATE_IDEMPOTENT_INSTRUCTION
    ) {
      continue;
    }

    const payerIndex = instruction.accountIndexes[0];
    const associatedAccountIndex = instruction.accountIndexes[1];
    if (payerIndex == null || associatedAccountIndex == null) continue;

    const payer = params.accountKeys[payerIndex] ?? null;
    const associatedAccount = params.accountKeys[associatedAccountIndex] ?? null;
    if (payer === params.walletAddress && associatedAccount != null) {
      accounts.add(associatedAccount);
    }
  }

  return Array.from(accounts);
}

async function estimateAssociatedTokenCreateRentLamports(params: {
  parsed: ReturnType<typeof parseSerializedTransaction>;
  accountKeys: string[];
  walletAddress: string;
  network: OffpayNetwork;
}): Promise<bigint | null> {
  const candidateAccounts = collectWalletPaidAssociatedTokenCreates(params);
  if (candidateAccounts.length === 0) return 0n;

  const accounts = await getRpcAccounts({
    addresses: candidateAccounts,
    network: params.network,
  });
  const missingAccountCount = candidateAccounts.reduce((count, _account, index) => {
    return accountExists(accounts.accounts[index]) ? count : count + 1;
  }, 0);
  if (missingAccountCount === 0) return 0n;

  const rent = await getRpcMinimumBalanceForRentExemption({
    space: SPL_TOKEN_ACCOUNT_SPACE,
    network: params.network,
  });
  if (rent.lamports == null) return null;

  return BigInt(rent.lamports) * BigInt(missingAccountCount);
}

async function estimateMagicBlockPrivatePaymentFee(params: {
  unsignedTransaction: string;
  parsed: ReturnType<typeof parseSerializedTransaction>;
  accountKeys: string[];
  walletAddress: string;
  network: OffpayNetwork;
}): Promise<{
  feeLamports: number | null;
  solFeePayer: string | null;
}> {
  const fee = await getRpcFeeForMessage({
    network: params.network,
    messageBase64: extractMessageBase64FromSerializedTransaction(params.unsignedTransaction),
  });

  const feePayer = params.parsed.accountKeys[0] ?? null;
  const walletPaysNetworkFee = feePayer === params.walletAddress;
  if (walletPaysNetworkFee && fee.lamports == null) {
    return {
      feeLamports: null,
      solFeePayer: feePayer,
    };
  }

  const systemLamports = params.parsed.instructions.reduce((sum, instruction) => {
    return (
      sum +
      getWalletFundedSystemLamports({
        instruction,
        accountKeys: params.accountKeys,
        walletAddress: params.walletAddress,
      })
    );
  }, 0n);
  const associatedTokenRentLamports = await estimateAssociatedTokenCreateRentLamports({
    parsed: params.parsed,
    accountKeys: params.accountKeys,
    walletAddress: params.walletAddress,
    network: params.network,
  });
  if (associatedTokenRentLamports == null) {
    return {
      feeLamports: null,
      solFeePayer: feePayer,
    };
  }

  const networkFeeLamports = walletPaysNetworkFee ? BigInt(fee.lamports ?? 0) : 0n;
  const totalLamports = networkFeeLamports + systemLamports + associatedTokenRentLamports;

  return {
    feeLamports: safeLamportsToNumber(totalLamports),
    solFeePayer: feePayer,
  };
}

function preparedPlanMatchesParams(
  params: SubmitPrivatePaymentParams,
  plan: PreparedPrivatePaymentPlan | null | undefined,
): plan is PreparedPrivatePaymentPlan {
  return (
    plan != null &&
    plan.walletAddress === params.walletAddress &&
    plan.recipient === params.recipient &&
    plan.mint === params.mint &&
    plan.amount === params.amount &&
    plan.network === params.network &&
    Date.now() - plan.preparedAt < 30_000 &&
    plan.expiresAt > Date.now() + 5_000
  );
}

function isBlockhashExpiredError(error: unknown): boolean {
  if (error instanceof OffpayApiError && error.code === 'QUOTE_EXPIRED') return true;
  const message = error instanceof Error ? error.message : '';
  return /blockhash not found|blockhash expired|expired blockhash/i.test(message);
}

function shouldQueueSignedPayment(error: unknown): boolean {
  if (!(error instanceof OffpayApiError)) return true;
  return error.retryable || error.code === 'RATE_LIMITED' || error.code === 'UPSTREAM_UNAVAILABLE';
}

function buildPrivatePaymentTxId(signedTransaction: string): string {
  const digest = sha256(Uint8Array.from(Buffer.from(signedTransaction, 'base64')));
  const uuidBytes = Uint8Array.from(digest.slice(0, 16));
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const hex = Array.from(uuidBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function prepareVerifySignPrivateSend(
  params: SubmitPrivatePaymentParams,
  options?: { ignorePreparedPlan?: boolean },
): Promise<{
  signedTransaction: string;
  verification: PrivatePaymentVerification;
  intentId: string;
  expiresAt: number;
}> {
  const startedAt = mark();
  let stage: 'prepare' | 'verify' | 'sign' = 'prepare';
  try {
    const plan =
      options?.ignorePreparedPlan !== true && preparedPlanMatchesParams(params, params.preparedPlan)
        ? params.preparedPlan
        : await preparePrivatePaymentPlanInternal(params, { estimateFee: false });
    if (plan === params.preparedPlan) {
      measure('magicblock.private.prepare.cached', mark(), { network: params.network });
    }

    stage = 'sign';
    const signStartedAt = mark();
    const signedTransaction = await signSerializedTransactionForWallet({
      unsignedTransaction: plan.unsignedTransaction,
      walletAddress: params.walletAddress,
      walletId: params.walletId,
    });
    verifyPrivatePaymentSignedTransaction({
      unsignedTransaction: plan.unsignedTransaction,
      signedTransaction,
      walletAddress: params.walletAddress,
    });
    measure('magicblock.private.sign', signStartedAt, { network: params.network });

    return {
      signedTransaction,
      verification: plan.verification,
      intentId: plan.intentId,
      expiresAt: plan.expiresAt,
    };
  } finally {
    measure('magicblock.private.prepareVerifySign', startedAt, {
      network: params.network,
      stage,
    });
  }
}

export async function preparePrivatePaymentPlan(
  params: PrivateSendRequest,
): Promise<PreparedPrivatePaymentPlan> {
  return preparePrivatePaymentPlanInternal(params, { estimateFee: true });
}

async function preparePrivatePaymentPlanInternal(
  params: PrivateSendRequest,
  options: { estimateFee: boolean },
): Promise<PreparedPrivatePaymentPlan> {
  assertPrivatePaymentInputs(params);
  const startedAt = mark();
  let stage: 'init-status' | 'prepare' | 'verify' | 'fee' = 'prepare';
  try {
    let includesMintInitialization = false;
    if (options.estimateFee) {
      stage = 'init-status';
      const initStatusStartedAt = mark();
      const initStatus = await initializePrivatePaymentMint({
        walletAddress: params.walletAddress,
        mintAddress: params.mint,
        network: params.network,
      });
      includesMintInitialization = initStatus.status === 'requires_signature';
      measure('magicblock.private.initMint.statusForPlan', initStatusStartedAt, {
        network: params.network,
        status: initStatus.status,
      });
    }

    stage = 'prepare';
    const prepareStartedAt = mark();
    const prepared = await preparePrivateSend({
      walletAddress: params.walletAddress,
      recipient: params.recipient,
      amount: params.amount,
      mint: params.mint,
      network: params.network,
    });
    measure('magicblock.private.prepare', prepareStartedAt, { network: params.network });

    const preparedTransaction = resolvePrivateSendTransaction(prepared);
    const parsed = parseSerializedTransaction(preparedTransaction.unsignedTransaction);
    const accountKeys = await resolveMessageAccountKeys(parsed, params.network);
    stage = 'verify';
    const verification = await verifyPrivatePaymentUnsignedTransaction({
      unsignedTransaction: preparedTransaction.unsignedTransaction,
      walletAddress: params.walletAddress,
      recipient: params.recipient,
      amount: params.amount,
      mint: params.mint,
      network: params.network,
      allowHiddenPrivateRecipient: true,
      privateRouteTransaction: preparedTransaction.transaction,
    });

    let feeLamports: number | null = null;
    let solFeePayer: string | null = null;
    if (options.estimateFee) {
      stage = 'fee';
      const feeStartedAt = mark();
      const feeEstimate = await estimateMagicBlockPrivatePaymentFee({
        unsignedTransaction: preparedTransaction.unsignedTransaction,
        parsed,
        accountKeys,
        walletAddress: params.walletAddress,
        network: params.network,
      });
      feeLamports = feeEstimate.feeLamports;
      solFeePayer = feeEstimate.solFeePayer;
      measure('magicblock.private.feeEstimate', feeStartedAt, {
        network: params.network,
        feeLamports: feeLamports ?? null,
        includesMintInitialization,
      });
    }

    return {
      walletAddress: params.walletAddress,
      recipient: params.recipient,
      mint: params.mint,
      amount: params.amount,
      network: params.network,
      intentId: preparedTransaction.intentId,
      expiresAt: preparedTransaction.expiresAt,
      unsignedTransaction: preparedTransaction.unsignedTransaction,
      transaction: preparedTransaction.transaction,
      verification,
      feeLamports,
      tokenFeeRaw: preparedTransaction.transaction?.fees?.tokens ?? '0',
      solFeePayer,
      includesMintInitialization,
      preparedAt: Date.now(),
    };
  } finally {
    measure('magicblock.private.preparePlan', startedAt, {
      network: params.network,
      stage,
    });
  }
}

async function queueSignedPrivatePayment(params: {
  request: SubmitPrivatePaymentParams;
  signedTransaction: string;
  verification: PrivatePaymentVerification;
  initSignature: string | null;
  intentId: string;
  expiresAt: number;
  error: unknown;
}): Promise<PrivatePaymentSubmitResult> {
  const txId = buildPrivatePaymentTxId(params.signedTransaction);
  const backup = await enqueuePendingPaymentBackup({
    walletAddress: params.request.walletAddress,
    walletId: params.request.walletId ?? undefined,
    network: params.request.network,
    txId,
    signedBlob: params.signedTransaction,
    kind: 'private-payment',
    metadata: {
      recipient: params.request.recipient,
      mint: params.request.mint,
      amount: params.request.amount,
      intentId: params.intentId,
      intentExpiresAt: params.expiresAt,
    },
    uploadImmediately: true,
  });

  return {
    status: 'queued',
    txId,
    uploaded: backup.uploaded,
    reason:
      params.error instanceof Error
        ? params.error.message
        : 'Payment submission could not complete.',
    initSignature: params.initSignature,
    verification: params.verification,
  };
}

async function initializeMintIfNeeded(params: SubmitPrivatePaymentParams): Promise<string | null> {
  const startedAt = mark();
  let status: PrivateInitMintResponse['status'] | 'unknown' = 'unknown';
  try {
    const initStartedAt = mark();
    const init = await initializePrivatePaymentMint({
      walletAddress: params.walletAddress,
      mintAddress: params.mint,
      network: params.network,
    });
    status = init.status;
    measure('magicblock.private.initMint.request', initStartedAt, {
      network: params.network,
      status,
    });

    if (init.status !== 'requires_signature') {
      return null;
    }

    const initTransaction = resolveInitTransactionBase64(init);
    if (initTransaction == null) {
      throw new Error(
        'Private mint initialization requires a signature but no transaction was returned.',
      );
    }

    await verifyMintInitTransaction({
      unsignedTransaction: initTransaction,
      walletAddress: params.walletAddress,
      mint: params.mint,
      network: params.network,
      transaction: init.transaction ?? null,
    });

    const signStartedAt = mark();
    const signedInitTransaction = await signSerializedTransactionForWallet({
      unsignedTransaction: initTransaction,
      walletAddress: params.walletAddress,
      walletId: params.walletId,
    });
    verifyPrivatePaymentSignedTransaction({
      unsignedTransaction: initTransaction,
      signedTransaction: signedInitTransaction,
      walletAddress: params.walletAddress,
    });
    measure('magicblock.private.initMint.sign', signStartedAt, { network: params.network });

    const broadcastStartedAt = mark();
    const result = await broadcastRawTransaction({
      rawTransaction: signedInitTransaction,
      network: params.network,
    });
    measure('magicblock.private.initMint.broadcast', broadcastStartedAt, {
      network: params.network,
    });

    return result.signature;
  } finally {
    measure('magicblock.private.initMint.total', startedAt, {
      network: params.network,
      status,
    });
  }
}

export async function submitPrivatePayment(
  params: SubmitPrivatePaymentParams,
): Promise<PrivatePaymentSubmitResult> {
  const startedAt = mark();
  let status: PrivatePaymentSubmitResult['status'] | 'error' = 'error';
  try {
    assertPrivatePaymentInputs(params);

    const preparedPlan = preparedPlanMatchesParams(params, params.preparedPlan)
      ? params.preparedPlan
      : null;
    const initSignature =
      preparedPlan?.includesMintInitialization === true
        ? null
        : await initializeMintIfNeeded(params);
    let signed = await prepareVerifySignPrivateSend(params);

    try {
      const broadcastStartedAt = mark();
      const submitted = await executePrivateSend({
        intentId: signed.intentId,
        walletAddress: params.walletAddress,
        network: params.network,
        signedTransaction: signed.signedTransaction,
      });
      measure('magicblock.private.broadcast', broadcastStartedAt, { network: params.network });

      status = 'submitted';
      return {
        status: 'submitted',
        signature: submitted.signature,
        initSignature,
        verification: signed.verification,
      };
    } catch (error) {
      if (isBlockhashExpiredError(error)) {
        signed = await prepareVerifySignPrivateSend(params, { ignorePreparedPlan: true });
        try {
          const retryBroadcastStartedAt = mark();
          const submitted = await executePrivateSend({
            intentId: signed.intentId,
            walletAddress: params.walletAddress,
            network: params.network,
            signedTransaction: signed.signedTransaction,
          });
          measure('magicblock.private.broadcast.retry', retryBroadcastStartedAt, {
            network: params.network,
          });

          status = 'submitted';
          return {
            status: 'submitted',
            signature: submitted.signature,
            initSignature,
            verification: signed.verification,
          };
        } catch (retryError) {
          if (!shouldQueueSignedPayment(retryError)) {
            throw retryError;
          }

          status = 'queued';
          return queueSignedPrivatePayment({
            request: params,
            signedTransaction: signed.signedTransaction,
            verification: signed.verification,
            initSignature,
            intentId: signed.intentId,
            expiresAt: signed.expiresAt,
            error: retryError,
          });
        }
      }

      if (!shouldQueueSignedPayment(error)) {
        throw error;
      }

      status = 'queued';
      return queueSignedPrivatePayment({
        request: params,
        signedTransaction: signed.signedTransaction,
        verification: signed.verification,
        initSignature,
        intentId: signed.intentId,
        expiresAt: signed.expiresAt,
        error,
      });
    }
  } finally {
    measure('magicblock.private.submit.total', startedAt, {
      network: params.network,
      status,
    });
  }
}

export function isNativeSolPrivatePaymentMint(mint: string): boolean {
  return mint.trim() === NATIVE_SOL_SYSTEM_MINT;
}
