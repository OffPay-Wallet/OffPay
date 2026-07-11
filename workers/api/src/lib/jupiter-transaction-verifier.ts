import { Buffer } from 'buffer';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  AddressLookupTableAccount,
  PublicKey,
  VersionedTransaction,
  type MessageCompiledInstruction,
} from '@solana/web3.js';

import { AppError } from './errors.js';
import { getRpcAccounts, type RpcAccountInfo } from './helius.js';
import { readBoundTransactionMessage } from './solana-transaction-binding.js';
import type { Bindings, Network } from './types.js';

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ADDRESS_LOOKUP_TABLE_PROGRAM_ID = 'AddressLookupTab1e1111111111111111111111111';
const JUPITER_V6_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const JUPITER_V6_EVENT_AUTHORITY = 'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf';
const JUPITER_RECURRING_PROGRAM_ID = 'DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M';
const JUPITER_EVENT_AUTHORITY = 'Cspp27eGUDMXxPEdhmEXFVRn6Lt1L7xJyALF3nmnWoBj';
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

const ROUTE_V2_DISCRIMINATOR = 'bb64facc31c4af14';
const SHARED_ACCOUNTS_ROUTE_V2_DISCRIMINATOR = 'd19853937cfed8e9';
const OPEN_DCA_DISCRIMINATOR = '8e772b6da2340bb1';
const CLOSE_DCA_DISCRIMINATOR = '16072162a8b722f3';
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
const MAX_PRIORITY_FEE_LAMPORTS = 10_000_000n;
const U64_MAX = (1n << 64n) - 1n;

interface JupiterVerifierAccountLoader {
  (addresses: readonly string[]): Promise<readonly RpcAccountInfo[]>;
}

interface JupiterIntentBase {
  walletAddress: string;
  providerRequestId?: string;
}

interface JupiterSwapTransactionIntent extends JupiterIntentBase {
  kind: 'swap';
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  minimumOutputAmount: string;
  slippageBps: number;
  platformFeeBps: number;
  receiverAddress?: string;
}

interface JupiterTriggerDepositTransactionIntent extends JupiterIntentBase {
  kind: 'triggerDeposit';
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  receiverAddress: string;
  orderSubType: 'single' | 'oco' | 'otoco';
}

interface JupiterRecurringCreateTransactionIntent extends JupiterIntentBase {
  kind: 'recurringCreate';
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  numberOfOrders: number;
  intervalSeconds: number;
}

interface JupiterRecurringCancelTransactionIntent extends JupiterIntentBase {
  kind: 'recurringCancel';
  orderAddress: string;
  inputMint: string;
  outputMint: string;
}

type JupiterTransactionIntent =
  | JupiterSwapTransactionIntent
  | JupiterTriggerDepositTransactionIntent
  | JupiterRecurringCreateTransactionIntent
  | JupiterRecurringCancelTransactionIntent;

interface VerifyJupiterTransactionRequest {
  bindings: Bindings;
  network: Network;
  transactionBase64: string;
  intent: JupiterTransactionIntent;
  requireWalletSignature?: boolean;
  accountLoader?: JupiterVerifierAccountLoader;
}

interface VerifiedJupiterTransaction {
  transactionMessageBase64: string;
  kind: JupiterTransactionIntent['kind'];
  feePayerAddress: string;
  signerAddresses: string[];
  programIds: string[];
  providerRequestId: string | null;
  maxPriorityFeeLamports: string;
  maxNewTokenAccounts: number;
  recurringOrderAddress: string | null;
}

interface JupiterTransactionVerifierImplementation {
  (request: VerifyJupiterTransactionRequest): Promise<VerifiedJupiterTransaction>;
}

interface ResolvedTransaction {
  transaction: VersionedTransaction;
  accountKeys: ReturnType<VersionedTransaction['message']['getAccountKeys']>;
  accountsByAddress: ReadonlyMap<string, RpcAccountInfo>;
}

interface ComputeBudgetSummary {
  maxPriorityFeeLamports: bigint;
}

interface AuxiliaryVerificationSummary {
  computeBudget: ComputeBudgetSummary;
  newTokenAccounts: number;
  recurringOrderAddress?: string;
}

function verificationFailure(label: string, reason: string): never {
  throw new AppError({
    status: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    message: `${label} transaction failed safety verification: ${reason}`,
    retryable: true,
  });
}

function parseRawAmount(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) verificationFailure(label, 'raw amount is invalid.');
  const amount = BigInt(value);
  if (amount <= 0n || amount > U64_MAX) {
    verificationFailure(label, 'raw amount is outside the valid token range.');
  }
  return amount;
}

function readU64(data: Uint8Array, offset: number, label: string): bigint {
  if (data.length < offset + 8) verificationFailure(label, 'instruction data is truncated.');
  return Buffer.from(data).readBigUInt64LE(offset);
}

function readU32(data: Uint8Array, offset: number, label: string): number {
  if (data.length < offset + 4) verificationFailure(label, 'instruction data is truncated.');
  return Buffer.from(data).readUInt32LE(offset);
}

function readU16(data: Uint8Array, offset: number, label: string): number {
  if (data.length < offset + 2) verificationFailure(label, 'instruction data is truncated.');
  return Buffer.from(data).readUInt16LE(offset);
}

function discriminator(data: Uint8Array): string {
  return Buffer.from(data.subarray(0, 8)).toString('hex');
}

function getInstructionProgram(
  instruction: MessageCompiledInstruction,
  accountKeys: ResolvedTransaction['accountKeys'],
  label: string,
): string {
  const program = accountKeys.get(instruction.programIdIndex)?.toBase58();
  if (!program) verificationFailure(label, 'instruction program account is missing.');
  return program;
}

function getInstructionAccount(
  instruction: MessageCompiledInstruction,
  accountKeys: ResolvedTransaction['accountKeys'],
  position: number,
  label: string,
): PublicKey {
  const index = instruction.accountKeyIndexes[position];
  const account = index == null ? undefined : accountKeys.get(index);
  if (!account) verificationFailure(label, 'instruction account list is malformed.');
  return account;
}

function requireAccount(
  instruction: MessageCompiledInstruction,
  accountKeys: ResolvedTransaction['accountKeys'],
  position: number,
  expected: string,
  label: string,
): void {
  if (getInstructionAccount(instruction, accountKeys, position, label).toBase58() !== expected) {
    verificationFailure(label, `instruction account ${position} does not match the intent.`);
  }
}

function deriveAssociatedTokenAddress(owner: string, mint: string, tokenProgram: string): string {
  return PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBuffer(),
      new PublicKey(tokenProgram).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
  )[0].toBase58();
}

function requireTokenProgram(program: string, label: string): void {
  if (program !== TOKEN_PROGRAM_ID && program !== TOKEN_2022_PROGRAM_ID) {
    verificationFailure(label, 'token program is not supported.');
  }
}

function requireMintOwner(
  accountsByAddress: ReadonlyMap<string, RpcAccountInfo>,
  mint: string,
  tokenProgram: string,
  label: string,
): void {
  const account = accountsByAddress.get(mint);
  if (!account?.exists || account.owner !== tokenProgram || account.executable !== false) {
    verificationFailure(label, `mint ${mint} is not owned by its declared token program.`);
  }
}

function verifyComputeBudget(
  instructions: readonly MessageCompiledInstruction[],
  accountKeys: ResolvedTransaction['accountKeys'],
  label: string,
): ComputeBudgetSummary {
  let unitLimit: number | null = null;
  let unitPriceMicroLamports: bigint | null = null;
  let computeInstructionCount = 0;

  for (const instruction of instructions) {
    if (getInstructionProgram(instruction, accountKeys, label) !== COMPUTE_BUDGET_PROGRAM_ID) {
      continue;
    }
    computeInstructionCount += 1;
    if (computeInstructionCount > 4 || instruction.accountKeyIndexes.length !== 0) {
      verificationFailure(label, 'compute-budget instructions are not canonical.');
    }
    const opcode = instruction.data[0];
    if (opcode === 0 || opcode == null || opcode > 4) {
      verificationFailure(label, 'compute-budget instruction is unsupported.');
    }
    if (opcode === 1 || opcode === 4) {
      if (instruction.data.length !== 5) {
        verificationFailure(label, 'compute-budget instruction is malformed.');
      }
      continue;
    }
    if (opcode === 2) {
      if (instruction.data.length !== 5 || unitLimit !== null) {
        verificationFailure(label, 'compute-unit limit is malformed or duplicated.');
      }
      unitLimit = readU32(instruction.data, 1, label);
      if (unitLimit <= 0 || unitLimit > MAX_COMPUTE_UNIT_LIMIT) {
        verificationFailure(label, 'compute-unit limit exceeds the safety policy.');
      }
      continue;
    }
    if (instruction.data.length !== 9 || unitPriceMicroLamports !== null) {
      verificationFailure(label, 'compute-unit price is malformed or duplicated.');
    }
    unitPriceMicroLamports = readU64(instruction.data, 1, label);
  }

  const effectiveLimit = BigInt(unitLimit ?? MAX_COMPUTE_UNIT_LIMIT);
  const priorityFee = ((unitPriceMicroLamports ?? 0n) * effectiveLimit + 999_999n) / 1_000_000n;
  if (priorityFee > MAX_PRIORITY_FEE_LAMPORTS) {
    verificationFailure(label, 'priority fee exceeds the safety policy.');
  }
  return { maxPriorityFeeLamports: priorityFee };
}

function verifyAssociatedTokenInstruction(params: {
  instruction: MessageCompiledInstruction;
  accountKeys: ResolvedTransaction['accountKeys'];
  walletAddress: string;
  permittedAccounts: ReadonlySet<string>;
  label: string;
}): void {
  const { instruction, accountKeys, walletAddress, permittedAccounts, label } = params;
  const data = instruction.data;
  if (
    !(
      (data.length === 0 || (data.length === 1 && data[0] === 1)) &&
      instruction.accountKeyIndexes.length >= 6
    )
  ) {
    verificationFailure(label, 'associated-token instruction is not a canonical create operation.');
  }
  requireAccount(instruction, accountKeys, 0, walletAddress, label);
  requireAccount(instruction, accountKeys, 4, SYSTEM_PROGRAM_ID, label);
  const tokenProgram = getInstructionAccount(instruction, accountKeys, 5, label).toBase58();
  requireTokenProgram(tokenProgram, label);
  const owner = getInstructionAccount(instruction, accountKeys, 2, label).toBase58();
  const mint = getInstructionAccount(instruction, accountKeys, 3, label).toBase58();
  const tokenAccount = getInstructionAccount(instruction, accountKeys, 1, label).toBase58();
  if (deriveAssociatedTokenAddress(owner, mint, tokenProgram) !== tokenAccount) {
    verificationFailure(label, 'associated-token address is not canonical.');
  }
  if (!permittedAccounts.has(tokenAccount)) {
    verificationFailure(label, 'associated-token creation is unrelated to the intent.');
  }
}

function verifySystemTransfer(params: {
  instruction: MessageCompiledInstruction;
  accountKeys: ResolvedTransaction['accountKeys'];
  from: string;
  to: string;
  amount: bigint;
  label: string;
}): void {
  const { instruction, accountKeys, from, to, amount, label } = params;
  if (
    instruction.data.length !== 12 ||
    readU32(instruction.data, 0, label) !== 2 ||
    readU64(instruction.data, 4, label) !== amount ||
    instruction.accountKeyIndexes.length !== 2
  ) {
    verificationFailure(label, 'system transfer does not match the exact intended amount.');
  }
  requireAccount(instruction, accountKeys, 0, from, label);
  requireAccount(instruction, accountKeys, 1, to, label);
}

function verifySyncNative(
  instruction: MessageCompiledInstruction,
  accountKeys: ResolvedTransaction['accountKeys'],
  tokenAccount: string,
  label: string,
): void {
  if (
    instruction.data.length !== 1 ||
    instruction.data[0] !== 17 ||
    instruction.accountKeyIndexes.length !== 1
  ) {
    verificationFailure(label, 'token instruction is not a canonical sync-native operation.');
  }
  requireAccount(instruction, accountKeys, 0, tokenAccount, label);
}

function verifyCloseWrappedSol(params: {
  instruction: MessageCompiledInstruction;
  accountKeys: ResolvedTransaction['accountKeys'];
  tokenAccount: string;
  receiver: string;
  authority: string;
  label: string;
}): void {
  const { instruction, accountKeys, tokenAccount, receiver, authority, label } = params;
  if (
    instruction.data.length !== 1 ||
    instruction.data[0] !== 9 ||
    instruction.accountKeyIndexes.length < 3
  ) {
    verificationFailure(label, 'token instruction is not a canonical close-account operation.');
  }
  requireAccount(instruction, accountKeys, 0, tokenAccount, label);
  requireAccount(instruction, accountKeys, 1, receiver, label);
  requireAccount(instruction, accountKeys, 2, authority, label);
  for (let position = 3; position < instruction.accountKeyIndexes.length; position += 1) {
    requireAccount(instruction, accountKeys, position, authority, label);
  }
}

function verifySwapTransaction(
  resolved: ResolvedTransaction,
  intent: JupiterSwapTransactionIntent,
  label: string,
): AuxiliaryVerificationSummary {
  const { transaction, accountKeys, accountsByAddress } = resolved;
  const inputAmount = parseRawAmount(intent.inputAmount, label);
  const receiver = intent.receiverAddress ?? intent.walletAddress;
  const jupiterInstructions = transaction.message.compiledInstructions.filter(
    (instruction) =>
      getInstructionProgram(instruction, accountKeys, label) === JUPITER_V6_PROGRAM_ID,
  );
  if (jupiterInstructions.length !== 1) {
    verificationFailure(label, 'exactly one Jupiter swap instruction is required.');
  }
  const route = jupiterInstructions[0];
  if (!route) verificationFailure(label, 'Jupiter swap instruction is missing.');
  const routeDiscriminator = discriminator(route.data);
  let userPosition: number;
  let sourcePosition: number;
  let destinationPosition: number;
  let inputMintPosition: number;
  let outputMintPosition: number;
  let inputProgramPosition: number;
  let outputProgramPosition: number;
  let amountOffset: number;
  let quotedOutputOffset: number;
  let slippageOffset: number;
  let platformFeeOffset: number;
  let positiveSlippageOffset: number;
  let routeCountOffset: number;
  if (routeDiscriminator === ROUTE_V2_DISCRIMINATOR) {
    [userPosition, sourcePosition, destinationPosition, inputMintPosition, outputMintPosition] = [
      0, 1, 2, 3, 4,
    ];
    [inputProgramPosition, outputProgramPosition] = [5, 6];
    [
      amountOffset,
      quotedOutputOffset,
      slippageOffset,
      platformFeeOffset,
      positiveSlippageOffset,
      routeCountOffset,
    ] = [8, 16, 24, 26, 28, 30];
  } else if (routeDiscriminator === SHARED_ACCOUNTS_ROUTE_V2_DISCRIMINATOR) {
    [userPosition, sourcePosition, destinationPosition, inputMintPosition, outputMintPosition] = [
      1, 2, 5, 6, 7,
    ];
    [inputProgramPosition, outputProgramPosition] = [8, 9];
    [
      amountOffset,
      quotedOutputOffset,
      slippageOffset,
      platformFeeOffset,
      positiveSlippageOffset,
      routeCountOffset,
    ] = [9, 17, 25, 27, 29, 31];
  } else {
    verificationFailure(label, 'Jupiter swap instruction variant is not verified.');
  }

  if (route.data.length < routeCountOffset + 4) {
    verificationFailure(label, 'Jupiter swap instruction fixed fields are truncated.');
  }

  if (routeDiscriminator === ROUTE_V2_DISCRIMINATOR) {
    if (route.accountKeyIndexes.length < 10) {
      verificationFailure(label, 'Jupiter route account list is truncated.');
    }
    requireAccount(route, accountKeys, 7, JUPITER_V6_PROGRAM_ID, label);
    requireAccount(route, accountKeys, 8, JUPITER_V6_EVENT_AUTHORITY, label);
    requireAccount(route, accountKeys, 9, JUPITER_V6_PROGRAM_ID, label);
  } else {
    if (route.accountKeyIndexes.length < 12) {
      verificationFailure(label, 'Jupiter shared-route account list is truncated.');
    }
    const authorityId = route.data[8];
    if (authorityId == null || authorityId > 15) {
      verificationFailure(label, 'Jupiter shared-route authority ID is invalid.');
    }
    const programAuthority = PublicKey.findProgramAddressSync(
      [Buffer.from('authority'), Buffer.from([authorityId])],
      new PublicKey(JUPITER_V6_PROGRAM_ID),
    )[0].toBase58();
    requireAccount(route, accountKeys, 0, programAuthority, label);
    requireAccount(route, accountKeys, 10, JUPITER_V6_EVENT_AUTHORITY, label);
    requireAccount(route, accountKeys, 11, JUPITER_V6_PROGRAM_ID, label);
  }
  const routePlanCount = readU32(route.data, routeCountOffset, label);
  if (
    routePlanCount < 1 ||
    routePlanCount > 16 ||
    route.data.length < routeCountOffset + 4 + routePlanCount * 5
  ) {
    verificationFailure(
      label,
      'Jupiter route plan is empty, truncated, or outside the safety limit.',
    );
  }

  requireAccount(route, accountKeys, userPosition, intent.walletAddress, label);
  requireAccount(route, accountKeys, inputMintPosition, intent.inputMint, label);
  requireAccount(route, accountKeys, outputMintPosition, intent.outputMint, label);
  if (readU64(route.data, amountOffset, label) !== inputAmount) {
    verificationFailure(label, 'Jupiter exact-input amount does not match the quote intent.');
  }
  const outputAmount = parseRawAmount(intent.outputAmount, label);
  const minimumOutputAmount = parseRawAmount(intent.minimumOutputAmount, label);
  if (
    !Number.isInteger(intent.slippageBps) ||
    intent.slippageBps < 0 ||
    intent.slippageBps > 10_000
  ) {
    verificationFailure(label, 'quoted slippage is outside the valid range.');
  }
  if (
    !Number.isInteger(intent.platformFeeBps) ||
    intent.platformFeeBps < 0 ||
    intent.platformFeeBps > 10_000
  ) {
    verificationFailure(label, 'quoted platform fee is outside the valid range.');
  }
  const quotedOutputAmount = readU64(route.data, quotedOutputOffset, label);
  const encodedSlippageBps = readU16(route.data, slippageOffset, label);
  const encodedPlatformFeeBps = readU16(route.data, platformFeeOffset, label);
  const encodedPositiveSlippageBps = readU16(route.data, positiveSlippageOffset, label);
  if (
    encodedSlippageBps !== intent.slippageBps ||
    encodedPlatformFeeBps !== intent.platformFeeBps ||
    encodedPositiveSlippageBps !== 0
  ) {
    verificationFailure(label, 'slippage or fee terms do not match the quote intent.');
  }
  if (minimumOutputAmount > outputAmount || quotedOutputAmount < outputAmount) {
    verificationFailure(label, 'quoted output amounts do not match the user-visible quote.');
  }
  const maximumQuotedDifference =
    (quotedOutputAmount * BigInt(intent.platformFeeBps) + 9_999n) / 10_000n + 1n;
  if (quotedOutputAmount - outputAmount > maximumQuotedDifference) {
    verificationFailure(label, 'on-chain quoted output diverges from the user-visible quote.');
  }
  const userVisibleThresholdNumerator = outputAmount * BigInt(10_000 - intent.slippageBps);
  const userVisibleMinimumFloor = userVisibleThresholdNumerator / 10_000n;
  const userVisibleMinimumCeil = (userVisibleThresholdNumerator + 9_999n) / 10_000n;
  const encodedThresholdNumerator = quotedOutputAmount * BigInt(10_000 - intent.slippageBps);
  const encodedMinimumFloor = encodedThresholdNumerator / 10_000n;
  const encodedMinimumCeil = (encodedThresholdNumerator + 9_999n) / 10_000n;
  if (
    (minimumOutputAmount !== userVisibleMinimumFloor &&
      minimumOutputAmount !== userVisibleMinimumCeil) ||
    encodedMinimumCeil < minimumOutputAmount ||
    encodedMinimumFloor < userVisibleMinimumFloor
  ) {
    verificationFailure(label, 'minimum output threshold does not match the quote intent.');
  }
  const inputProgram = getInstructionAccount(
    route,
    accountKeys,
    inputProgramPosition,
    label,
  ).toBase58();
  const outputProgram = getInstructionAccount(
    route,
    accountKeys,
    outputProgramPosition,
    label,
  ).toBase58();
  requireTokenProgram(inputProgram, label);
  requireTokenProgram(outputProgram, label);
  requireMintOwner(accountsByAddress, intent.inputMint, inputProgram, label);
  requireMintOwner(accountsByAddress, intent.outputMint, outputProgram, label);

  const source = deriveAssociatedTokenAddress(intent.walletAddress, intent.inputMint, inputProgram);
  const destination = deriveAssociatedTokenAddress(receiver, intent.outputMint, outputProgram);
  requireAccount(route, accountKeys, sourcePosition, source, label);
  requireAccount(route, accountKeys, destinationPosition, destination, label);

  const permittedAtas = new Set([source, destination]);
  let nativeInputTransferCount = 0;
  let nativeInputSyncCount = 0;
  let nativeInputCloseCount = 0;
  let nativeOutputCloseCount = 0;
  let newTokenAccounts = 0;
  for (const instruction of transaction.message.compiledInstructions) {
    const program = getInstructionProgram(instruction, accountKeys, label);
    if (program === COMPUTE_BUDGET_PROGRAM_ID || program === JUPITER_V6_PROGRAM_ID) continue;
    if (program === ASSOCIATED_TOKEN_PROGRAM_ID) {
      verifyAssociatedTokenInstruction({
        instruction,
        accountKeys,
        walletAddress: intent.walletAddress,
        permittedAccounts: permittedAtas,
        label,
      });
      newTokenAccounts += 1;
      continue;
    }
    if (program === SYSTEM_PROGRAM_ID) {
      if (intent.inputMint !== WRAPPED_SOL_MINT || nativeInputTransferCount !== 0) {
        verificationFailure(label, 'unrelated system value movement is present.');
      }
      verifySystemTransfer({
        instruction,
        accountKeys,
        from: intent.walletAddress,
        to: source,
        amount: inputAmount,
        label,
      });
      nativeInputTransferCount += 1;
      continue;
    }
    if (program === TOKEN_PROGRAM_ID || program === TOKEN_2022_PROGRAM_ID) {
      if (
        program === inputProgram &&
        intent.inputMint === WRAPPED_SOL_MINT &&
        instruction.data[0] === 17
      ) {
        verifySyncNative(instruction, accountKeys, source, label);
        nativeInputSyncCount += 1;
        continue;
      }
      if (
        program === inputProgram &&
        intent.inputMint === WRAPPED_SOL_MINT &&
        instruction.data[0] === 9
      ) {
        verifyCloseWrappedSol({
          instruction,
          accountKeys,
          tokenAccount: source,
          receiver: intent.walletAddress,
          authority: intent.walletAddress,
          label,
        });
        nativeInputCloseCount += 1;
        continue;
      }
      if (
        program === outputProgram &&
        intent.outputMint === WRAPPED_SOL_MINT &&
        instruction.data[0] === 9
      ) {
        verifyCloseWrappedSol({
          instruction,
          accountKeys,
          tokenAccount: destination,
          receiver,
          authority: intent.walletAddress,
          label,
        });
        nativeOutputCloseCount += 1;
        continue;
      }
      verificationFailure(label, 'unrelated token value movement is present.');
    }
    verificationFailure(label, `unapproved top-level program ${program} is present.`);
  }

  if (
    intent.inputMint === WRAPPED_SOL_MINT &&
    (nativeInputTransferCount !== 1 || nativeInputSyncCount !== 1 || nativeInputCloseCount !== 1)
  ) {
    verificationFailure(label, 'native SOL input wrapping is incomplete or ambiguous.');
  }
  if (
    intent.inputMint !== WRAPPED_SOL_MINT &&
    (nativeInputTransferCount !== 0 || nativeInputSyncCount !== 0 || nativeInputCloseCount !== 0)
  ) {
    verificationFailure(label, 'unexpected native SOL input handling is present.');
  }
  if (intent.outputMint === WRAPPED_SOL_MINT && nativeOutputCloseCount !== 1) {
    verificationFailure(label, 'native SOL output unwrapping is missing.');
  }
  if (intent.outputMint !== WRAPPED_SOL_MINT && nativeOutputCloseCount !== 0) {
    verificationFailure(label, 'unexpected native SOL output handling is present.');
  }

  return {
    computeBudget: verifyComputeBudget(
      transaction.message.compiledInstructions,
      accountKeys,
      label,
    ),
    newTokenAccounts,
  };
}

function verifyTokenTransferChecked(params: {
  instruction: MessageCompiledInstruction;
  accountKeys: ResolvedTransaction['accountKeys'];
  source: string;
  destination: string;
  mint: string;
  owner: string;
  amount: bigint;
  label: string;
}): void {
  const { instruction, accountKeys, source, destination, mint, owner, amount, label } = params;
  if (instruction.data[0] === 12) {
    if (instruction.data.length !== 10 || readU64(instruction.data, 1, label) !== amount) {
      verificationFailure(label, 'checked token transfer amount is invalid.');
    }
    requireAccount(instruction, accountKeys, 0, source, label);
    requireAccount(instruction, accountKeys, 1, mint, label);
    requireAccount(instruction, accountKeys, 2, destination, label);
    requireAccount(instruction, accountKeys, 3, owner, label);
    return;
  }
  if (instruction.data[0] === 3) {
    if (instruction.data.length !== 9 || readU64(instruction.data, 1, label) !== amount) {
      verificationFailure(label, 'token transfer amount is invalid.');
    }
    requireAccount(instruction, accountKeys, 0, source, label);
    requireAccount(instruction, accountKeys, 1, destination, label);
    requireAccount(instruction, accountKeys, 2, owner, label);
    return;
  }
  verificationFailure(label, 'token instruction is not an exact transfer.');
}

function verifyTriggerDepositTransaction(
  resolved: ResolvedTransaction,
  intent: JupiterTriggerDepositTransactionIntent,
  label: string,
): AuxiliaryVerificationSummary {
  const { transaction, accountKeys, accountsByAddress } = resolved;
  const amount = parseRawAmount(intent.inputAmount, label);
  const inputAccount = accountsByAddress.get(intent.inputMint);
  const inputProgram = inputAccount?.owner ?? null;
  if (!inputProgram) verificationFailure(label, 'input mint account is unavailable.');
  requireTokenProgram(inputProgram, label);
  requireMintOwner(accountsByAddress, intent.inputMint, inputProgram, label);
  const source = deriveAssociatedTokenAddress(intent.walletAddress, intent.inputMint, inputProgram);
  const destination = deriveAssociatedTokenAddress(
    intent.receiverAddress,
    intent.inputMint,
    inputProgram,
  );
  const permittedAtas = new Set([source, destination]);

  if (intent.orderSubType === 'otoco') {
    const outputAccount = accountsByAddress.get(intent.outputMint);
    const outputProgram = outputAccount?.owner ?? null;
    if (!outputProgram) verificationFailure(label, 'output mint account is unavailable.');
    requireTokenProgram(outputProgram, label);
    requireMintOwner(accountsByAddress, intent.outputMint, outputProgram, label);
    permittedAtas.add(
      deriveAssociatedTokenAddress(intent.receiverAddress, intent.outputMint, outputProgram),
    );
  }

  let exactTransferCount = 0;
  let syncCount = 0;
  let closeCount = 0;
  let newTokenAccounts = 0;
  for (const instruction of transaction.message.compiledInstructions) {
    const program = getInstructionProgram(instruction, accountKeys, label);
    if (program === COMPUTE_BUDGET_PROGRAM_ID) continue;
    if (program === ASSOCIATED_TOKEN_PROGRAM_ID) {
      verifyAssociatedTokenInstruction({
        instruction,
        accountKeys,
        walletAddress: intent.walletAddress,
        permittedAccounts: permittedAtas,
        label,
      });
      newTokenAccounts += 1;
      continue;
    }
    if (program === SYSTEM_PROGRAM_ID) {
      if (intent.inputMint !== WRAPPED_SOL_MINT || exactTransferCount !== 0) {
        verificationFailure(label, 'unrelated system value movement is present.');
      }
      verifySystemTransfer({
        instruction,
        accountKeys,
        from: intent.walletAddress,
        to: intent.receiverAddress,
        amount,
        label,
      });
      exactTransferCount += 1;
      continue;
    }
    if (program === inputProgram) {
      if (instruction.data[0] === 17 && intent.inputMint === WRAPPED_SOL_MINT) {
        verifySyncNative(instruction, accountKeys, source, label);
        syncCount += 1;
        continue;
      }
      if (instruction.data[0] === 9 && intent.inputMint === WRAPPED_SOL_MINT) {
        verifyCloseWrappedSol({
          instruction,
          accountKeys,
          tokenAccount: source,
          receiver: intent.walletAddress,
          authority: intent.walletAddress,
          label,
        });
        closeCount += 1;
        continue;
      }
      if (exactTransferCount !== 0)
        verificationFailure(label, 'multiple deposit transfers are present.');
      verifyTokenTransferChecked({
        instruction,
        accountKeys,
        source,
        destination,
        mint: intent.inputMint,
        owner: intent.walletAddress,
        amount,
        label,
      });
      exactTransferCount += 1;
      continue;
    }
    verificationFailure(label, `unapproved top-level program ${program} is present.`);
  }
  if (exactTransferCount !== 1)
    verificationFailure(label, 'exactly one vault deposit is required.');
  if (syncCount !== 0 || closeCount !== 0) {
    verificationFailure(label, 'wrapped-SOL vault deposits are not supported safely.');
  }
  return {
    computeBudget: verifyComputeBudget(
      transaction.message.compiledInstructions,
      accountKeys,
      label,
    ),
    newTokenAccounts,
  };
}

function requireRecurringFixedAccounts(params: {
  instruction: MessageCompiledInstruction;
  accountKeys: ResolvedTransaction['accountKeys'];
  systemPosition: number;
  tokenProgramPosition: number;
  associatedTokenPosition: number;
  eventAuthorityPosition: number;
  programPosition: number;
  tokenProgram: string;
  label: string;
}): void {
  const { instruction, accountKeys, tokenProgram, label } = params;
  requireAccount(instruction, accountKeys, params.systemPosition, SYSTEM_PROGRAM_ID, label);
  requireAccount(instruction, accountKeys, params.tokenProgramPosition, tokenProgram, label);
  requireAccount(
    instruction,
    accountKeys,
    params.associatedTokenPosition,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    label,
  );
  requireAccount(
    instruction,
    accountKeys,
    params.eventAuthorityPosition,
    JUPITER_EVENT_AUTHORITY,
    label,
  );
  requireAccount(
    instruction,
    accountKeys,
    params.programPosition,
    JUPITER_RECURRING_PROGRAM_ID,
    label,
  );
}

function verifyRecurringCreateTransaction(
  resolved: ResolvedTransaction,
  intent: JupiterRecurringCreateTransactionIntent,
  label: string,
): AuxiliaryVerificationSummary {
  const { transaction, accountKeys, accountsByAddress } = resolved;
  if (!Number.isInteger(intent.numberOfOrders) || intent.numberOfOrders <= 0) {
    verificationFailure(label, 'order count is invalid.');
  }
  if (!Number.isInteger(intent.intervalSeconds) || intent.intervalSeconds <= 0) {
    verificationFailure(label, 'interval is invalid.');
  }
  const total = parseRawAmount(intent.inputAmount, label);
  const dcaInstructions = transaction.message.compiledInstructions.filter(
    (instruction) =>
      getInstructionProgram(instruction, accountKeys, label) === JUPITER_RECURRING_PROGRAM_ID,
  );
  if (dcaInstructions.length !== 1)
    verificationFailure(label, 'exactly one recurring instruction is required.');
  const open = dcaInstructions[0];
  if (!open || discriminator(open.data) !== OPEN_DCA_DISCRIMINATOR || open.data.length !== 43) {
    verificationFailure(label, 'recurring open instruction variant is not verified.');
  }
  if (open.accountKeyIndexes.length !== 13)
    verificationFailure(label, 'recurring account list is not canonical.');
  requireAccount(open, accountKeys, 1, intent.walletAddress, label);
  requireAccount(open, accountKeys, 2, intent.walletAddress, label);
  requireAccount(open, accountKeys, 3, intent.inputMint, label);
  requireAccount(open, accountKeys, 4, intent.outputMint, label);
  const tokenProgram = getInstructionAccount(open, accountKeys, 9, label).toBase58();
  if (tokenProgram !== TOKEN_PROGRAM_ID) {
    verificationFailure(label, 'Jupiter Recurring supports only the classic SPL Token Program.');
  }
  requireMintOwner(accountsByAddress, intent.inputMint, tokenProgram, label);
  requireMintOwner(accountsByAddress, intent.outputMint, tokenProgram, label);
  const source = deriveAssociatedTokenAddress(intent.walletAddress, intent.inputMint, tokenProgram);
  const orderAddress = getInstructionAccount(open, accountKeys, 0, label).toBase58();
  requireAccount(open, accountKeys, 5, source, label);
  requireAccount(
    open,
    accountKeys,
    6,
    deriveAssociatedTokenAddress(orderAddress, intent.inputMint, tokenProgram),
    label,
  );
  requireAccount(
    open,
    accountKeys,
    7,
    deriveAssociatedTokenAddress(orderAddress, intent.outputMint, tokenProgram),
    label,
  );
  requireRecurringFixedAccounts({
    instruction: open,
    accountKeys,
    systemPosition: 8,
    tokenProgramPosition: 9,
    associatedTokenPosition: 10,
    eventAuthorityPosition: 11,
    programPosition: 12,
    tokenProgram,
    label,
  });
  if (readU64(open.data, 16, label) !== total) {
    verificationFailure(label, 'recurring total input does not match the intent.');
  }
  const expectedPerOrder = total / BigInt(intent.numberOfOrders);
  if (expectedPerOrder <= 0n || readU64(open.data, 24, label) !== expectedPerOrder) {
    verificationFailure(label, 'recurring per-order amount does not match the schedule.');
  }
  if (readU64(open.data, 32, label) !== BigInt(intent.intervalSeconds)) {
    verificationFailure(label, 'recurring interval does not match the schedule.');
  }
  if (open.data[40] !== 0 || open.data[41] !== 0 || open.data[42] !== 0) {
    verificationFailure(label, 'unexpected recurring price or start conditions are present.');
  }

  const permittedAtas = new Set([source]);
  let transferCount = 0;
  let syncCount = 0;
  let closeCount = 0;
  let newTokenAccounts = 0;
  for (const instruction of transaction.message.compiledInstructions) {
    const program = getInstructionProgram(instruction, accountKeys, label);
    if (program === COMPUTE_BUDGET_PROGRAM_ID || program === JUPITER_RECURRING_PROGRAM_ID) continue;
    if (program === ASSOCIATED_TOKEN_PROGRAM_ID) {
      verifyAssociatedTokenInstruction({
        instruction,
        accountKeys,
        walletAddress: intent.walletAddress,
        permittedAccounts: permittedAtas,
        label,
      });
      newTokenAccounts += 1;
      continue;
    }
    if (program === SYSTEM_PROGRAM_ID) {
      if (intent.inputMint !== WRAPPED_SOL_MINT || transferCount !== 0) {
        verificationFailure(label, 'unrelated system value movement is present.');
      }
      verifySystemTransfer({
        instruction,
        accountKeys,
        from: intent.walletAddress,
        to: source,
        amount: total,
        label,
      });
      transferCount += 1;
      continue;
    }
    if (
      program === tokenProgram &&
      intent.inputMint === WRAPPED_SOL_MINT &&
      instruction.data[0] === 17
    ) {
      verifySyncNative(instruction, accountKeys, source, label);
      syncCount += 1;
      continue;
    }
    if (
      program === tokenProgram &&
      intent.inputMint === WRAPPED_SOL_MINT &&
      instruction.data[0] === 9
    ) {
      verifyCloseWrappedSol({
        instruction,
        accountKeys,
        tokenAccount: source,
        receiver: intent.walletAddress,
        authority: intent.walletAddress,
        label,
      });
      closeCount += 1;
      continue;
    }
    verificationFailure(label, `unapproved top-level program ${program} is present.`);
  }
  if (
    intent.inputMint === WRAPPED_SOL_MINT &&
    (transferCount !== 1 || syncCount !== 1 || closeCount !== 1)
  ) {
    verificationFailure(label, 'native SOL recurring deposit handling is incomplete.');
  }
  if (
    intent.inputMint !== WRAPPED_SOL_MINT &&
    (transferCount !== 0 || syncCount !== 0 || closeCount !== 0)
  ) {
    verificationFailure(label, 'unexpected native SOL handling is present.');
  }
  return {
    computeBudget: verifyComputeBudget(
      transaction.message.compiledInstructions,
      accountKeys,
      label,
    ),
    newTokenAccounts,
    recurringOrderAddress: orderAddress,
  };
}

function verifyRecurringCancelTransaction(
  resolved: ResolvedTransaction,
  intent: JupiterRecurringCancelTransactionIntent,
  label: string,
): AuxiliaryVerificationSummary {
  const { transaction, accountKeys, accountsByAddress } = resolved;
  const closeInstructions = transaction.message.compiledInstructions.filter(
    (instruction) =>
      getInstructionProgram(instruction, accountKeys, label) === JUPITER_RECURRING_PROGRAM_ID,
  );
  if (closeInstructions.length !== 1)
    verificationFailure(label, 'exactly one recurring close instruction is required.');
  const close = closeInstructions[0];
  if (!close || discriminator(close.data) !== CLOSE_DCA_DISCRIMINATOR || close.data.length !== 8) {
    verificationFailure(label, 'recurring close instruction variant is not verified.');
  }
  if (close.accountKeyIndexes.length !== 13)
    verificationFailure(label, 'recurring close account list is not canonical.');
  requireAccount(close, accountKeys, 0, intent.walletAddress, label);
  requireAccount(close, accountKeys, 1, intent.orderAddress, label);
  requireAccount(close, accountKeys, 2, intent.inputMint, label);
  requireAccount(close, accountKeys, 3, intent.outputMint, label);
  const tokenProgram = getInstructionAccount(close, accountKeys, 9, label).toBase58();
  if (tokenProgram !== TOKEN_PROGRAM_ID) {
    verificationFailure(label, 'Jupiter Recurring supports only the classic SPL Token Program.');
  }
  requireMintOwner(accountsByAddress, intent.inputMint, tokenProgram, label);
  requireMintOwner(accountsByAddress, intent.outputMint, tokenProgram, label);
  requireAccount(
    close,
    accountKeys,
    4,
    deriveAssociatedTokenAddress(intent.orderAddress, intent.inputMint, tokenProgram),
    label,
  );
  requireAccount(
    close,
    accountKeys,
    5,
    deriveAssociatedTokenAddress(intent.orderAddress, intent.outputMint, tokenProgram),
    label,
  );
  requireAccount(
    close,
    accountKeys,
    6,
    deriveAssociatedTokenAddress(intent.walletAddress, intent.inputMint, tokenProgram),
    label,
  );
  requireAccount(
    close,
    accountKeys,
    7,
    deriveAssociatedTokenAddress(intent.walletAddress, intent.outputMint, tokenProgram),
    label,
  );
  requireRecurringFixedAccounts({
    instruction: close,
    accountKeys,
    systemPosition: 8,
    tokenProgramPosition: 9,
    associatedTokenPosition: 10,
    eventAuthorityPosition: 11,
    programPosition: 12,
    tokenProgram,
    label,
  });
  const orderAccount = accountsByAddress.get(intent.orderAddress);
  if (!orderAccount?.exists || orderAccount.owner !== JUPITER_RECURRING_PROGRAM_ID) {
    verificationFailure(label, 'recurring order account is not owned by Jupiter Recurring.');
  }
  for (const instruction of transaction.message.compiledInstructions) {
    const program = getInstructionProgram(instruction, accountKeys, label);
    if (program !== COMPUTE_BUDGET_PROGRAM_ID && program !== JUPITER_RECURRING_PROGRAM_ID) {
      verificationFailure(label, `unapproved top-level program ${program} is present.`);
    }
  }
  return {
    computeBudget: verifyComputeBudget(
      transaction.message.compiledInstructions,
      accountKeys,
      label,
    ),
    newTokenAccounts: 0,
    recurringOrderAddress: intent.orderAddress,
  };
}

async function resolveTransaction(params: {
  transaction: VersionedTransaction;
  intent: JupiterTransactionIntent;
  accountLoader: JupiterVerifierAccountLoader;
  label: string;
}): Promise<ResolvedTransaction> {
  const lookupAddresses = params.transaction.message.addressTableLookups.map((lookup) =>
    lookup.accountKey.toBase58(),
  );
  const requiredAddresses = new Set<string>(lookupAddresses);
  if ('inputMint' in params.intent) requiredAddresses.add(params.intent.inputMint);
  if ('outputMint' in params.intent) requiredAddresses.add(params.intent.outputMint);
  if (params.intent.kind === 'recurringCancel') requiredAddresses.add(params.intent.orderAddress);
  const loadedAccounts = await params.accountLoader([...requiredAddresses]);
  const accountsByAddress = new Map(loadedAccounts.map((account) => [account.address, account]));
  for (const address of requiredAddresses) {
    if (!accountsByAddress.has(address)) {
      verificationFailure(params.label, `required on-chain account ${address} is unavailable.`);
    }
  }
  const lookupTables = lookupAddresses.map((address) => {
    const account = accountsByAddress.get(address);
    if (
      !account?.exists ||
      account.owner !== ADDRESS_LOOKUP_TABLE_PROGRAM_ID ||
      !account.dataBase64
    ) {
      verificationFailure(params.label, `address lookup table ${address} is unavailable.`);
    }
    try {
      return new AddressLookupTableAccount({
        key: new PublicKey(address),
        state: AddressLookupTableAccount.deserialize(Buffer.from(account.dataBase64, 'base64')),
      });
    } catch {
      verificationFailure(params.label, `address lookup table ${address} is invalid.`);
    }
  });
  let accountKeys: ResolvedTransaction['accountKeys'];
  try {
    accountKeys = params.transaction.message.getAccountKeys({
      addressLookupTableAccounts: lookupTables,
    });
  } catch {
    verificationFailure(params.label, 'transaction account keys cannot be resolved safely.');
  }
  return { transaction: params.transaction, accountKeys, accountsByAddress };
}

async function verifyJupiterTransactionStrict(
  request: VerifyJupiterTransactionRequest,
): Promise<VerifiedJupiterTransaction> {
  const label =
    request.intent.kind === 'swap'
      ? 'Jupiter swap'
      : request.intent.kind === 'triggerDeposit'
        ? 'Jupiter Trigger deposit'
        : request.intent.kind === 'recurringCreate'
          ? 'Jupiter Recurring create'
          : 'Jupiter Recurring cancel';
  if (request.network !== 'mainnet') {
    verificationFailure(label, 'this verifier accepts mainnet transactions only.');
  }
  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(
      Buffer.from(request.transactionBase64, 'base64'),
    );
  } catch {
    verificationFailure(label, 'wire payload is invalid.');
  }
  const transactionMessageBase64 = readBoundTransactionMessage({
    transactionBase64: request.transactionBase64,
    requiredSignerAddress: request.intent.walletAddress,
    requiredFeePayerAddress: request.intent.walletAddress,
    requireSignerSignature: request.requireWalletSignature === true,
    label,
  });
  const signerKeys = transaction.message.staticAccountKeys.slice(
    0,
    transaction.message.header.numRequiredSignatures,
  );
  if (signerKeys.length !== 1 || signerKeys[0]?.toBase58() !== request.intent.walletAddress) {
    verificationFailure(label, 'the active wallet must be the sole signer and fee payer.');
  }
  const walletSignature = transaction.signatures[0];
  const messageBytes = transaction.message.serialize();
  if (request.requireWalletSignature === true) {
    if (
      !walletSignature ||
      walletSignature.every((byte) => byte === 0) ||
      !ed25519.verify(walletSignature, messageBytes, signerKeys[0].toBytes())
    ) {
      verificationFailure(label, 'the active-wallet signature is invalid.');
    }
  } else if (walletSignature && !walletSignature.every((byte) => byte === 0)) {
    verificationFailure(
      label,
      'the provider transaction unexpectedly contains a wallet signature.',
    );
  }

  const accountLoader =
    request.accountLoader ??
    (async (addresses: readonly string[]) =>
      (
        await getRpcAccounts(request.bindings, {
          addresses: [...addresses],
          network: request.network,
        })
      ).accounts);
  const resolved = await resolveTransaction({
    transaction,
    intent: request.intent,
    accountLoader,
    label,
  });
  let summary: AuxiliaryVerificationSummary;
  if (request.intent.kind === 'swap') {
    summary = verifySwapTransaction(resolved, request.intent, label);
  } else if (request.intent.kind === 'triggerDeposit') {
    summary = verifyTriggerDepositTransaction(resolved, request.intent, label);
  } else if (request.intent.kind === 'recurringCreate') {
    summary = verifyRecurringCreateTransaction(resolved, request.intent, label);
  } else {
    summary = verifyRecurringCancelTransaction(resolved, request.intent, label);
  }
  const programIds = [
    ...new Set(
      transaction.message.compiledInstructions.map((instruction) =>
        getInstructionProgram(instruction, resolved.accountKeys, label),
      ),
    ),
  ];
  return {
    transactionMessageBase64,
    kind: request.intent.kind,
    feePayerAddress: request.intent.walletAddress,
    signerAddresses: signerKeys.map((key) => key.toBase58()),
    programIds,
    providerRequestId: request.intent.providerRequestId?.trim() || null,
    maxPriorityFeeLamports: summary.computeBudget.maxPriorityFeeLamports.toString(),
    maxNewTokenAccounts: summary.newTokenAccounts,
    recurringOrderAddress: summary.recurringOrderAddress ?? null,
  };
}

let verifierImplementation: JupiterTransactionVerifierImplementation =
  verifyJupiterTransactionStrict;

async function verifyJupiterTransaction(
  request: VerifyJupiterTransactionRequest,
): Promise<VerifiedJupiterTransaction> {
  return verifierImplementation(request);
}

function setJupiterTransactionVerifierImplementationForTests(
  implementation: JupiterTransactionVerifierImplementation,
): void {
  verifierImplementation = implementation;
}

function resetJupiterTransactionVerifierImplementationForTests(): void {
  verifierImplementation = verifyJupiterTransactionStrict;
}

export {
  ADDRESS_LOOKUP_TABLE_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  CLOSE_DCA_DISCRIMINATOR,
  COMPUTE_BUDGET_PROGRAM_ID,
  JUPITER_EVENT_AUTHORITY,
  JUPITER_RECURRING_PROGRAM_ID,
  JUPITER_V6_EVENT_AUTHORITY,
  JUPITER_V6_PROGRAM_ID,
  OPEN_DCA_DISCRIMINATOR,
  ROUTE_V2_DISCRIMINATOR,
  SHARED_ACCOUNTS_ROUTE_V2_DISCRIMINATOR,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
  resetJupiterTransactionVerifierImplementationForTests,
  setJupiterTransactionVerifierImplementationForTests,
  verifyJupiterTransaction,
  type JupiterRecurringCancelTransactionIntent,
  type JupiterRecurringCreateTransactionIntent,
  type JupiterSwapTransactionIntent,
  type JupiterTransactionIntent,
  type JupiterTransactionVerifierImplementation,
  type JupiterTriggerDepositTransactionIntent,
  type JupiterVerifierAccountLoader,
  type VerifiedJupiterTransaction,
  type VerifyJupiterTransactionRequest,
};
