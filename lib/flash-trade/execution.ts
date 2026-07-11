import { ed25519 } from '@noble/curves/ed25519.js';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  type SignatureStatus,
  VersionedTransaction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';

import {
  FLASH_CONFIRMATION_TIMEOUT_MS,
  FLASH_MAGICBLOCK_RPC_URL,
  FLASH_V2_PROGRAM_ID,
} from './constants';
import type {
  FlashEncodedAmount,
  FlashExpectedMarketAccounts,
  FlashExpectedTriggerOrder,
  FlashPrivilege,
  FlashTradeEconomicIntent,
} from './types';

export type FlashTradeOperation = FlashTradeEconomicIntent['operation'];

export interface FlashTradeTransactionIntent {
  walletAddress: string;
  economicIntent: FlashTradeEconomicIntent;
}

export interface FlashDecodedEconomicInstruction {
  name: string;
  accountPubkeys?: string[];
  executionPrice?: number;
  collateralRawAmount?: string;
  sizeRawAmount?: string;
  usdAmountRaw?: string;
  triggerPrice?: number;
  isStopLoss?: boolean;
  orderSlot?: number;
  privilege?: FlashPrivilege;
}

export interface VerifiedFlashTradeTransaction {
  transaction: VersionedTransaction;
  messageBase64: string;
  walletSignerIndex: number;
  flashInstructionNames: string[];
}

export interface FlashTradeSendResult {
  signature: string;
  confirmMs: number;
}

interface FlashTradeRpc {
  getAddressLookupTable(address: PublicKey): Promise<{ value: AddressLookupTableAccount | null }>;
  isBlockhashValid(blockhash: string): Promise<{ value: boolean }>;
  sendRawTransaction(
    rawTransaction: Uint8Array,
    options: { skipPreflight: boolean; maxRetries: number },
  ): Promise<string>;
  getSignatureStatuses(signatures: string[]): Promise<{ value: (SignatureStatus | null)[] }>;
}

interface InstructionRule {
  name: string;
  discriminator: readonly number[];
  accountCount: number;
  poolAccountIndex: number | null;
  marketAccountIndex: number | null;
  targetCustodyAccountIndex: number | null;
  collateralCustodyAccountIndex: number | null;
  selectedCustodyAccountIndexes: readonly number[];
  userDepositLedgerAccountIndex: number | null;
  reallocVaultAccountIndex: number | null;
  eventAuthorityAccountIndex: number;
  programAccountIndex: number;
  instructionSysvarAccountIndex: number | null;
}

const FLASH_PROGRAM = new PublicKey(FLASH_V2_PROGRAM_ID);
const COMPUTE_PROGRAM = ComputeBudgetProgram.programId;
const INSTRUCTION_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const PERPETUALS_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from('perpetuals')],
  FLASH_PROGRAM,
)[0];
const REALLOC_VAULT_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from('realloc_vault')],
  FLASH_PROGRAM,
)[0];
const EVENT_AUTHORITY_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from('__event_authority')],
  FLASH_PROGRAM,
)[0];
const DIRECT_SESSION_TOKEN_PLACEHOLDER = FLASH_PROGRAM;
const MAX_U64 = (1n << 64n) - 1n;
const LIVE_COMPUTE_UNIT_LIMIT = 1_400_000;

const INSTRUCTIONS = {
  addCollateral: rule('add_collateral_er', [225, 45, 149, 66, 116, 160, 228, 93], {
    accountCount: 18,
    pool: 7,
    market: 6,
    target: 8,
    collateral: 10,
    selected: [9],
    depositLedger: 5,
    realloc: 14,
    event: 15,
    program: 16,
    sysvar: 17,
  }),
  cancelAll: rule('cancel_all_trigger_orders_er', [12, 88, 216, 235, 206, 172, 173, 7], {
    accountCount: 7,
    event: 5,
    program: 6,
  }),
  cancelTrigger: rule('cancel_trigger_order_er', [200, 204, 193, 155, 116, 240, 109, 102], {
    accountCount: 7,
    event: 5,
    program: 6,
  }),
  closePosition: rule('close_position_er', [119, 84, 92, 18, 238, 109, 30, 92], {
    accountCount: 17,
    pool: 5,
    market: 6,
    target: 7,
    collateral: 8,
    selected: [9],
    realloc: 13,
    event: 14,
    program: 15,
    sysvar: 16,
  }),
  decreasePosition: rule('decrease_position_size_er', [86, 27, 2, 240, 254, 19, 198, 82], {
    accountCount: 17,
    pool: 6,
    market: 5,
    target: 7,
    collateral: 9,
    selected: [8],
    realloc: 13,
    event: 14,
    program: 15,
    sysvar: 16,
  }),
  editTrigger: rule('edit_trigger_order_er', [210, 42, 124, 21, 61, 255, 24, 1], {
    accountCount: 15,
    pool: 5,
    market: 6,
    target: 7,
    collateral: 8,
    selected: [9],
    event: 12,
    program: 13,
    sysvar: 14,
  }),
  increasePosition: rule('increase_position_size_er', [251, 56, 156, 33, 104, 173, 132, 247], {
    accountCount: 18,
    pool: 7,
    market: 6,
    target: 8,
    collateral: 10,
    selected: [9],
    depositLedger: 5,
    realloc: 14,
    event: 15,
    program: 16,
    sysvar: 17,
  }),
  openPosition: rule('open_position_er', [56, 132, 228, 149, 65, 34, 167, 111], {
    accountCount: 18,
    pool: 6,
    market: 7,
    target: 8,
    collateral: 9,
    selected: [10],
    depositLedger: 5,
    realloc: 14,
    event: 15,
    program: 16,
    sysvar: 17,
  }),
  placeLimit: rule('place_limit_order_er', [81, 75, 213, 34, 116, 52, 25, 191], {
    accountCount: 18,
    pool: 6,
    market: 7,
    target: 8,
    collateral: 9,
    selected: [10, 11],
    depositLedger: 5,
    realloc: 14,
    event: 15,
    program: 16,
    sysvar: 17,
  }),
  placeTrigger: rule('place_trigger_order_er', [18, 150, 225, 93, 42, 182, 3, 56], {
    accountCount: 16,
    pool: 5,
    market: 6,
    target: 7,
    collateral: 8,
    selected: [9],
    realloc: 12,
    event: 13,
    program: 14,
    sysvar: 15,
  }),
  removeCollateral: rule('remove_collateral_er', [130, 70, 144, 213, 96, 254, 1, 225], {
    accountCount: 17,
    pool: 6,
    market: 5,
    target: 7,
    collateral: 9,
    selected: [8],
    realloc: 13,
    event: 14,
    program: 15,
    sysvar: 16,
  }),
} as const;

const INSTRUCTION_RULES = Object.values(INSTRUCTIONS);

function rule(
  name: string,
  discriminator: readonly number[],
  indexes: {
    accountCount: number;
    pool?: number;
    market?: number;
    target?: number;
    collateral?: number;
    selected?: readonly number[];
    depositLedger?: number;
    realloc?: number;
    event: number;
    program: number;
    sysvar?: number;
  },
): InstructionRule {
  return {
    name,
    discriminator,
    accountCount: indexes.accountCount,
    poolAccountIndex: indexes.pool ?? null,
    marketAccountIndex: indexes.market ?? null,
    targetCustodyAccountIndex: indexes.target ?? null,
    collateralCustodyAccountIndex: indexes.collateral ?? null,
    selectedCustodyAccountIndexes: indexes.selected ?? [],
    userDepositLedgerAccountIndex: indexes.depositLedger ?? null,
    reallocVaultAccountIndex: indexes.realloc ?? null,
    eventAuthorityAccountIndex: indexes.event,
    programAccountIndex: indexes.program,
    instructionSysvarAccountIndex: indexes.sysvar ?? null,
  };
}

function decodeTransaction(transactionBase64: string): VersionedTransaction {
  if (typeof transactionBase64 !== 'string' || transactionBase64.length === 0) {
    throw new Error('Flash Trade transaction is missing.');
  }
  try {
    return VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));
  } catch {
    throw new Error('Flash Trade returned an invalid versioned transaction.');
  }
}

function isNonZeroSignature(signature: Uint8Array): boolean {
  return signature.some((byte) => byte !== 0);
}

function discriminatorMatches(data: Uint8Array, discriminator: readonly number[]): boolean {
  return (
    data.length >= discriminator.length &&
    discriminator.every((byte, index) => data[index] === byte)
  );
}

function findInstructionRule(data: Uint8Array): InstructionRule | null {
  return (
    INSTRUCTION_RULES.find((candidate) => discriminatorMatches(data, candidate.discriminator)) ??
    null
  );
}

function expectedPrimaryInstruction(intent: FlashTradeEconomicIntent): InstructionRule {
  switch (intent.operation) {
    case 'open_position':
      if (intent.tradeType === 'limit') return INSTRUCTIONS.placeLimit;
      return intent.positionChange === 'increase'
        ? INSTRUCTIONS.increasePosition
        : INSTRUCTIONS.openPosition;
    case 'close_position':
      return intent.closeMode === 'full'
        ? INSTRUCTIONS.closePosition
        : INSTRUCTIONS.decreasePosition;
    case 'add_collateral':
      return INSTRUCTIONS.addCollateral;
    case 'remove_collateral':
      return INSTRUCTIONS.removeCollateral;
    case 'place_trigger_order':
      return INSTRUCTIONS.placeTrigger;
    case 'edit_trigger_order':
      return INSTRUCTIONS.editTrigger;
    case 'cancel_trigger_order':
      return INSTRUCTIONS.cancelTrigger;
    case 'cancel_all_trigger_orders':
      return INSTRUCTIONS.cancelAll;
    case 'reverse_position':
      return INSTRUCTIONS.closePosition;
  }
}

function allowedFlashInstructionNames(intent: FlashTradeEconomicIntent): Set<string> {
  if (intent.operation === 'open_position') {
    return new Set([expectedPrimaryInstruction(intent).name, INSTRUCTIONS.placeTrigger.name]);
  }
  if (intent.operation === 'close_position' && intent.closeMode === 'full') {
    return new Set([
      INSTRUCTIONS.closePosition.name,
      INSTRUCTIONS.cancelAll.name,
      INSTRUCTIONS.cancelTrigger.name,
    ]);
  }
  if (intent.operation === 'reverse_position') {
    return new Set([
      INSTRUCTIONS.closePosition.name,
      INSTRUCTIONS.cancelAll.name,
      INSTRUCTIONS.cancelTrigger.name,
      INSTRUCTIONS.openPosition.name,
    ]);
  }
  if (intent.operation === 'cancel_all_trigger_orders') {
    return new Set([INSTRUCTIONS.cancelAll.name, INSTRUCTIONS.cancelTrigger.name]);
  }
  return new Set([expectedPrimaryInstruction(intent).name]);
}

function readCancelMarket(data: Uint8Array): string {
  if (data.length < 40) throw new Error('Flash Trade cancel instruction is malformed.');
  return new PublicKey(data.slice(8, 40)).toBase58();
}

function readU64LittleEndian(data: Uint8Array, offset: number, label: string): bigint {
  if (data.length < offset + 8) {
    throw new Error(`Flash Trade ${label} instruction is malformed.`);
  }
  return Buffer.from(data).readBigUInt64LE(offset);
}

function parseExpectedU64(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Flash Trade ${label} intent is not an exact raw integer.`);
  }
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > MAX_U64) {
    throw new Error(`Flash Trade ${label} intent is outside the valid u64 range.`);
  }
  return parsed;
}

function requireExactLength(data: Uint8Array, expected: number, label: string): void {
  if (data.length !== expected) {
    throw new Error(`Flash Trade ${label} instruction has an unexpected data layout.`);
  }
}

function readStrictBoolean(data: Uint8Array, offset: number, label: string): boolean {
  const value = data[offset];
  if (value !== 0 && value !== 1) {
    throw new Error(`Flash Trade ${label} instruction contains an invalid boolean.`);
  }
  return value === 1;
}

function readPrivilege(data: Uint8Array, offset: number, label: string): FlashPrivilege {
  const value = data[offset];
  if (value === 0) return 'none';
  if (value === 1) return 'stake';
  if (value === 2) return 'referral';
  throw new Error(`Flash Trade ${label} instruction contains an invalid privilege enum.`);
}

function readOraclePrice(data: Uint8Array, offset: number): number {
  if (data.length < offset + 12) throw new Error('Flash Trade price instruction is malformed.');
  const view = Buffer.from(data);
  const rawPriceBigInt = view.readBigUInt64LE(offset);
  if (rawPriceBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Flash Trade instruction price exceeds the safe integer range.');
  }
  const rawPrice = Number(rawPriceBigInt);
  const exponent = view.readInt32LE(offset + 8);
  const price = rawPrice * 10 ** exponent;
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('Flash Trade instruction contains an invalid price.');
  }
  return price;
}

function pricesMatch(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-7);
}

function validateExpectedTriggerOrders(
  observed: readonly FlashDecodedEconomicInstruction[],
  expected: readonly FlashExpectedTriggerOrder[],
): void {
  if (observed.length !== expected.length) {
    throw new Error('Flash Trade transaction does not match the requested TP/SL count.');
  }
  const remaining = [...observed];
  for (const target of expected) {
    const index = remaining.findIndex(
      (candidate) =>
        candidate.isStopLoss === target.isStopLoss &&
        candidate.triggerPrice != null &&
        pricesMatch(candidate.triggerPrice, target.triggerPrice) &&
        candidate.sizeRawAmount === target.size.rawAmount,
    );
    if (index < 0) {
      throw new Error('Flash Trade transaction contains an unexpected TP/SL price or size.');
    }
    remaining.splice(index, 1);
  }
}

function validateCancelParameters(
  ruleMatch: InstructionRule,
  data: Uint8Array,
  expectedMarketPubkey: string,
  expectedOrder?: { orderSlot: number; isStopLoss: boolean },
): void {
  const market = readCancelMarket(data);
  if (market !== expectedMarketPubkey) {
    throw new Error('Flash Trade cancel transaction targets an unexpected market.');
  }

  if (ruleMatch.name === INSTRUCTIONS.cancelAll.name) {
    requireExactLength(data, 40, 'cancel-all');
    if (expectedOrder != null) {
      throw new Error('Flash Trade cancel transaction does not target the requested order.');
    }
    return;
  }
  requireExactLength(data, 42, 'cancel');
  const orderSlot = data[40];
  const isStopLoss = readStrictBoolean(data, 41, 'cancel');
  if (expectedOrder == null) {
    if (orderSlot !== 255) {
      throw new Error('Flash Trade cancel-all transaction does not cancel every trigger slot.');
    }
    return;
  }
  if (orderSlot !== expectedOrder.orderSlot) {
    throw new Error('Flash Trade cancel transaction targets an unexpected order slot.');
  }
  if (isStopLoss !== expectedOrder.isStopLoss) {
    throw new Error('Flash Trade cancel transaction targets an unexpected order type.');
  }
}

function decodeEconomicInstruction(
  ruleMatch: InstructionRule,
  data: Uint8Array,
): FlashDecodedEconomicInstruction {
  if (ruleMatch.name === INSTRUCTIONS.openPosition.name) {
    requireExactLength(data, 37, 'open-position');
    return {
      name: ruleMatch.name,
      executionPrice: readOraclePrice(data, 8),
      collateralRawAmount: readU64LittleEndian(data, 20, 'open-position collateral').toString(),
      sizeRawAmount: readU64LittleEndian(data, 28, 'open-position size').toString(),
      privilege: readPrivilege(data, 36, 'open-position'),
    };
  }
  if (ruleMatch.name === INSTRUCTIONS.increasePosition.name) {
    requireExactLength(data, 37, 'increase-position');
    return {
      name: ruleMatch.name,
      executionPrice: readOraclePrice(data, 8),
      sizeRawAmount: readU64LittleEndian(data, 20, 'increase-position size').toString(),
      collateralRawAmount: readU64LittleEndian(data, 28, 'increase-position collateral').toString(),
      privilege: readPrivilege(data, 36, 'increase-position'),
    };
  }
  if (ruleMatch.name === INSTRUCTIONS.placeLimit.name) {
    requireExactLength(data, 60, 'limit-order');
    return {
      name: ruleMatch.name,
      executionPrice: readOraclePrice(data, 8),
      collateralRawAmount: readU64LittleEndian(data, 20, 'limit reserve').toString(),
      sizeRawAmount: readU64LittleEndian(data, 28, 'limit size').toString(),
    };
  }
  if (ruleMatch.name === INSTRUCTIONS.closePosition.name) {
    requireExactLength(data, 21, 'close-position');
    return {
      name: ruleMatch.name,
      executionPrice: readOraclePrice(data, 8),
      privilege: readPrivilege(data, 20, 'close-position'),
    };
  }
  if (ruleMatch.name === INSTRUCTIONS.decreasePosition.name) {
    requireExactLength(data, 29, 'decrease-position');
    return {
      name: ruleMatch.name,
      executionPrice: readOraclePrice(data, 8),
      sizeRawAmount: readU64LittleEndian(data, 20, 'decrease-position size').toString(),
      privilege: readPrivilege(data, 28, 'decrease-position'),
    };
  }
  if (ruleMatch.name === INSTRUCTIONS.addCollateral.name) {
    requireExactLength(data, 16, 'add-collateral');
    return {
      name: ruleMatch.name,
      collateralRawAmount: readU64LittleEndian(data, 8, 'add-collateral amount').toString(),
    };
  }
  if (ruleMatch.name === INSTRUCTIONS.removeCollateral.name) {
    requireExactLength(data, 16, 'remove-collateral');
    return {
      name: ruleMatch.name,
      usdAmountRaw: readU64LittleEndian(data, 8, 'remove-collateral USD amount').toString(),
    };
  }
  if (ruleMatch.name === INSTRUCTIONS.placeTrigger.name) {
    requireExactLength(data, 29, 'place-trigger');
    return {
      name: ruleMatch.name,
      triggerPrice: readOraclePrice(data, 8),
      sizeRawAmount: readU64LittleEndian(data, 20, 'trigger size').toString(),
      isStopLoss: readStrictBoolean(data, 28, 'place-trigger'),
    };
  }
  if (ruleMatch.name === INSTRUCTIONS.editTrigger.name) {
    requireExactLength(data, 30, 'edit-trigger');
    return {
      name: ruleMatch.name,
      orderSlot: data[8],
      triggerPrice: readOraclePrice(data, 9),
      sizeRawAmount: readU64LittleEndian(data, 21, 'edit-trigger size').toString(),
      isStopLoss: readStrictBoolean(data, 29, 'edit-trigger'),
    };
  }
  if (
    ruleMatch.name === INSTRUCTIONS.cancelTrigger.name ||
    ruleMatch.name === INSTRUCTIONS.cancelAll.name
  ) {
    return {
      name: ruleMatch.name,
      orderSlot: ruleMatch.name === INSTRUCTIONS.cancelTrigger.name ? data[40] : undefined,
      isStopLoss:
        ruleMatch.name === INSTRUCTIONS.cancelTrigger.name
          ? readStrictBoolean(data, 41, 'cancel')
          : undefined,
    };
  }
  throw new Error('Flash Trade transaction contains an unsupported protocol instruction.');
}

export function decodeFlashTradeEconomicInstructions(
  transactionBase64: string,
): FlashDecodedEconomicInstruction[] {
  const transaction = decodeTransaction(transactionBase64);
  if (transaction.message.version !== 0) {
    throw new Error('Flash Trade must return a V0 transaction.');
  }
  const staticKeys = transaction.message.staticAccountKeys;
  const decoded: FlashDecodedEconomicInstruction[] = [];
  for (const instruction of transaction.message.compiledInstructions) {
    const program = staticKeys[instruction.programIdIndex];
    if (program?.equals(COMPUTE_PROGRAM)) continue;
    if (program == null || !program.equals(FLASH_PROGRAM)) {
      throw new Error('Flash Trade economic inspection found an unexpected program.');
    }
    const ruleMatch = findInstructionRule(instruction.data);
    if (ruleMatch == null) {
      throw new Error('Flash Trade economic inspection found an unknown instruction.');
    }
    const accountPubkeys = instruction.accountKeyIndexes.map((index) => {
      const account = staticKeys[index];
      if (account == null) {
        throw new Error(
          'Flash Trade economic inspection cannot resolve a lookup-table account safely.',
        );
      }
      return account.toBase58();
    });
    decoded.push({ ...decodeEconomicInstruction(ruleMatch, instruction.data), accountPubkeys });
  }
  if (decoded.length === 0) {
    throw new Error('Flash Trade transaction contains no supported protocol instruction.');
  }
  return decoded;
}

async function resolveLookupTables(
  transaction: VersionedTransaction,
  rpc: FlashTradeRpc,
): Promise<AddressLookupTableAccount[]> {
  const lookups = transaction.message.addressTableLookups;
  return Promise.all(
    lookups.map(async (lookup) => {
      const response = await rpc.getAddressLookupTable(lookup.accountKey);
      if (response.value == null) {
        throw new Error(
          `Flash Trade address lookup table is unavailable: ${lookup.accountKey.toBase58()}`,
        );
      }
      return response.value;
    }),
  );
}

function verifyRequiredSignatures(
  transaction: VersionedTransaction,
  walletSignerIndex: number,
  requireWalletSignature: boolean,
): void {
  const message = transaction.message.serialize();
  const signerCount = transaction.message.header.numRequiredSignatures;
  for (let index = 0; index < signerCount; index += 1) {
    const signature = transaction.signatures[index];
    const hasSignature = signature != null && isNonZeroSignature(signature);
    if (index === walletSignerIndex && !requireWalletSignature && !hasSignature) continue;
    if (!hasSignature) {
      throw new Error('Flash Trade transaction is missing a required protocol signature.');
    }
    const signer = transaction.message.staticAccountKeys[index];
    if (signer == null || !ed25519.verify(signature, message, signer.toBytes())) {
      throw new Error('Flash Trade transaction contains an invalid required signature.');
    }
  }
}

interface CompiledInstructionView {
  accountKeyIndexes: readonly number[];
  data: Uint8Array;
}

interface ResolvedAccountKeys {
  get(index: number): PublicKey | undefined;
}

function accountAt(
  accountKeys: ResolvedAccountKeys,
  instruction: CompiledInstructionView,
  logicalIndex: number,
  label: string,
): PublicKey {
  const messageIndex = instruction.accountKeyIndexes[logicalIndex];
  const account = messageIndex == null ? undefined : accountKeys.get(messageIndex);
  if (account == null) {
    throw new Error(`Flash Trade transaction is missing its ${label} account.`);
  }
  return account;
}

function requireAccount(
  accountKeys: ResolvedAccountKeys,
  instruction: CompiledInstructionView,
  logicalIndex: number,
  expected: PublicKey | string,
  label: string,
): void {
  const expectedKey = typeof expected === 'string' ? new PublicKey(expected) : expected;
  if (!accountAt(accountKeys, instruction, logicalIndex, label).equals(expectedKey)) {
    throw new Error(`Flash Trade transaction contains an unexpected ${label} account.`);
  }
}

function validateComputeBudgetInstruction(data: Uint8Array): void {
  if (data.length !== 5 || data[0] !== 2) {
    throw new Error('Flash Trade transaction contains an unsupported compute-budget instruction.');
  }
  const units = Buffer.from(data).readUInt32LE(1);
  if (units !== LIVE_COMPUTE_UNIT_LIMIT) {
    throw new Error('Flash Trade transaction contains an unexpected compute-unit limit.');
  }
}

function validateCommonInstructionAccounts(params: {
  ruleMatch: InstructionRule;
  instruction: CompiledInstructionView;
  accountKeys: ResolvedAccountKeys;
  wallet: PublicKey;
  market: FlashExpectedMarketAccounts | null;
  selectedCustodyPubkey?: string;
}): void {
  const { ruleMatch, instruction, accountKeys, wallet, market, selectedCustodyPubkey } = params;
  if (instruction.accountKeyIndexes.length !== ruleMatch.accountCount) {
    throw new Error('Flash Trade transaction contains an unexpected protocol account layout.');
  }

  const basketPda = PublicKey.findProgramAddressSync(
    [Buffer.from('basket'), wallet.toBuffer()],
    FLASH_PROGRAM,
  )[0];
  const depositLedgerPda = PublicKey.findProgramAddressSync(
    [Buffer.from('user_deposit_ledger'), wallet.toBuffer()],
    FLASH_PROGRAM,
  )[0];
  requireAccount(accountKeys, instruction, 0, wallet, 'owner');
  requireAccount(accountKeys, instruction, 1, wallet, 'signer');
  requireAccount(accountKeys, instruction, 2, DIRECT_SESSION_TOKEN_PLACEHOLDER, 'session token');
  requireAccount(accountKeys, instruction, 3, PERPETUALS_PDA, 'perpetuals');
  requireAccount(accountKeys, instruction, 4, basketPda, 'basket');
  requireAccount(
    accountKeys,
    instruction,
    ruleMatch.eventAuthorityAccountIndex,
    EVENT_AUTHORITY_PDA,
    'event authority',
  );
  requireAccount(accountKeys, instruction, ruleMatch.programAccountIndex, FLASH_PROGRAM, 'program');

  if (ruleMatch.userDepositLedgerAccountIndex != null) {
    requireAccount(
      accountKeys,
      instruction,
      ruleMatch.userDepositLedgerAccountIndex,
      depositLedgerPda,
      'user deposit ledger',
    );
  }
  if (ruleMatch.reallocVaultAccountIndex != null) {
    requireAccount(
      accountKeys,
      instruction,
      ruleMatch.reallocVaultAccountIndex,
      REALLOC_VAULT_PDA,
      'realloc vault',
    );
  }
  if (ruleMatch.instructionSysvarAccountIndex != null) {
    requireAccount(
      accountKeys,
      instruction,
      ruleMatch.instructionSysvarAccountIndex,
      INSTRUCTION_SYSVAR,
      'instructions sysvar',
    );
  }

  if (market != null) {
    if (
      ruleMatch.poolAccountIndex == null ||
      ruleMatch.marketAccountIndex == null ||
      ruleMatch.targetCustodyAccountIndex == null ||
      ruleMatch.collateralCustodyAccountIndex == null
    ) {
      throw new Error('Flash Trade instruction cannot be bound to the requested market accounts.');
    }
    requireAccount(accountKeys, instruction, ruleMatch.poolAccountIndex, market.poolPubkey, 'pool');
    requireAccount(
      accountKeys,
      instruction,
      ruleMatch.marketAccountIndex,
      market.marketPubkey,
      'market',
    );
    requireAccount(
      accountKeys,
      instruction,
      ruleMatch.targetCustodyAccountIndex,
      market.targetCustodyPubkey,
      'target custody',
    );
    requireAccount(
      accountKeys,
      instruction,
      ruleMatch.collateralCustodyAccountIndex,
      market.collateralCustodyPubkey,
      'collateral custody',
    );
  }

  if (selectedCustodyPubkey != null) {
    if (ruleMatch.selectedCustodyAccountIndexes.length === 0) {
      throw new Error('Flash Trade instruction cannot bind the selected settlement token.');
    }
    for (const index of ruleMatch.selectedCustodyAccountIndexes) {
      requireAccount(accountKeys, instruction, index, selectedCustodyPubkey, 'selected custody');
    }
  }
}

function requireRawAmount(
  actual: string | undefined,
  expected: FlashEncodedAmount,
  label: string,
): void {
  parseExpectedU64(expected.rawAmount, label);
  if (actual !== expected.rawAmount) {
    throw new Error(`Flash Trade ${label} does not match the confirmed amount.`);
  }
}

function requireUsdRawAmount(actual: string | undefined, expected: string): void {
  parseExpectedU64(expected, 'USD amount');
  if (actual !== expected) {
    throw new Error('Flash Trade USD amount does not match the confirmed amount.');
  }
}

function requirePrice(actual: number | undefined, expected: number, label: string): void {
  if (
    actual == null ||
    !Number.isFinite(expected) ||
    expected <= 0 ||
    !pricesMatch(actual, expected)
  ) {
    throw new Error(`Flash Trade ${label} does not match the confirmed price.`);
  }
}

function requireOptionalPrice(actual: number, expected: number | undefined, label: string): void {
  if (expected == null) {
    if (actual !== 0) {
      throw new Error(`Flash Trade transaction contains an unexpected ${label}.`);
    }
    return;
  }
  requirePrice(actual, expected, label);
}

function requirePrivilege(
  actual: FlashPrivilege | undefined,
  expected: FlashPrivilege,
  label: string,
): void {
  if (actual !== expected) {
    throw new Error(`Flash Trade ${label} does not match the confirmed privilege.`);
  }
}

function validateEconomicIntentMarketSides(intent: FlashTradeEconomicIntent): void {
  if (intent.operation === 'reverse_position') {
    if (intent.sourceMarket.side !== intent.sourceSide) {
      throw new Error('Flash Trade reverse source market does not match the confirmed side.');
    }
    if (intent.destinationMarket.side !== intent.destinationSide) {
      throw new Error('Flash Trade reverse destination market does not match the confirmed side.');
    }
    if (intent.sourceSide === intent.destinationSide) {
      throw new Error('Flash Trade reverse intent must change the position side.');
    }
    if (intent.sourceMarket.marketPubkey === intent.destinationMarket.marketPubkey) {
      throw new Error('Flash Trade reverse intent must use distinct side-specific markets.');
    }
    if (intent.closePrivilege !== 'none' || intent.openPrivilege !== 'none') {
      throw new Error('Flash Trade privileged reverse instructions are not supported.');
    }
    return;
  }

  if ('market' in intent && intent.market.side !== intent.side) {
    throw new Error('Flash Trade market does not match the confirmed side.');
  }
  if (intent.operation === 'open_position') {
    if (intent.tradeType === 'limit') {
      if (intent.privilege !== null) {
        throw new Error('Flash Trade limit orders cannot contain a privilege intent.');
      }
    } else if (intent.privilege !== 'none') {
      throw new Error('Flash Trade privileged open instructions are not supported.');
    }
  } else if (intent.operation === 'close_position' && intent.privilege !== 'none') {
    throw new Error('Flash Trade privileged close instructions are not supported.');
  }
}

function marketForInstruction(
  intent: FlashTradeEconomicIntent,
  ruleMatch: InstructionRule,
): FlashExpectedMarketAccounts | null {
  if (intent.operation !== 'reverse_position') {
    return 'market' in intent ? intent.market : null;
  }
  return ruleMatch.name === INSTRUCTIONS.openPosition.name
    ? intent.destinationMarket
    : ruleMatch.name === INSTRUCTIONS.closePosition.name
      ? intent.sourceMarket
      : null;
}

function selectedCustodyForInstruction(
  intent: FlashTradeEconomicIntent,
  ruleMatch: InstructionRule,
): string | undefined {
  switch (intent.operation) {
    case 'open_position':
      return intent.inputCustodyPubkey;
    case 'close_position':
      return ruleMatch.name === INSTRUCTIONS.closePosition.name ||
        ruleMatch.name === INSTRUCTIONS.decreasePosition.name
        ? intent.outputCustodyPubkey
        : undefined;
    case 'add_collateral':
      return intent.inputCustodyPubkey;
    case 'remove_collateral':
      return intent.outputCustodyPubkey;
    case 'place_trigger_order':
    case 'edit_trigger_order':
      return intent.receiveCustodyPubkey;
    case 'cancel_trigger_order':
    case 'cancel_all_trigger_orders':
      return undefined;
    case 'reverse_position':
      return ruleMatch.name === INSTRUCTIONS.closePosition.name ||
        ruleMatch.name === INSTRUCTIONS.openPosition.name
        ? intent.settlementCustodyPubkey
        : undefined;
  }
}

export async function verifyFlashTradeTransaction(params: {
  transactionBase64: string;
  intent: FlashTradeTransactionIntent;
  requireWalletSignature?: boolean;
  rpc?: FlashTradeRpc;
}): Promise<VerifiedFlashTradeTransaction> {
  const rpc =
    params.rpc ?? (new Connection(FLASH_MAGICBLOCK_RPC_URL, 'confirmed') as FlashTradeRpc);
  const transaction = decodeTransaction(params.transactionBase64);
  if (transaction.message.version !== 0) {
    throw new Error('Flash Trade must return a V0 transaction.');
  }

  const wallet = new PublicKey(params.intent.walletAddress);
  const signerCount = transaction.message.header.numRequiredSignatures;
  const walletSignerIndex = transaction.message.staticAccountKeys
    .slice(0, signerCount)
    .findIndex((key) => key.equals(wallet));
  if (walletSignerIndex < 0) {
    throw new Error('Flash Trade transaction does not require the active wallet signature.');
  }
  if (!transaction.message.staticAccountKeys[0]?.equals(wallet)) {
    throw new Error('Flash Trade transaction has an unexpected fee payer.');
  }
  verifyRequiredSignatures(transaction, walletSignerIndex, params.requireWalletSignature === true);

  const lookupTables = await resolveLookupTables(transaction, rpc);
  const accountKeys = transaction.message.getAccountKeys({
    addressLookupTableAccounts: lookupTables,
  });
  const economicIntent = params.intent.economicIntent;
  validateEconomicIntentMarketSides(economicIntent);
  const allowedNames = allowedFlashInstructionNames(economicIntent);
  const flashInstructionNames: string[] = [];
  const observedTriggerOrders: FlashDecodedEconomicInstruction[] = [];
  let computeInstructionCount = 0;

  for (const instruction of transaction.message.compiledInstructions) {
    const program = accountKeys.get(instruction.programIdIndex);
    if (program == null)
      throw new Error('Flash Trade transaction contains an invalid program index.');
    if (program.equals(COMPUTE_PROGRAM)) {
      computeInstructionCount += 1;
      if (computeInstructionCount > 1) {
        throw new Error('Flash Trade transaction repeats its compute-budget instruction.');
      }
      validateComputeBudgetInstruction(instruction.data);
      continue;
    }
    if (!program.equals(FLASH_PROGRAM)) {
      throw new Error(
        `Flash Trade transaction invokes an unexpected program: ${program.toBase58()}`,
      );
    }

    const ruleMatch = findInstructionRule(instruction.data);
    if (ruleMatch == null || !allowedNames.has(ruleMatch.name)) {
      throw new Error('Flash Trade transaction contains an unexpected protocol instruction.');
    }
    flashInstructionNames.push(ruleMatch.name);
    const decoded = decodeEconomicInstruction(ruleMatch, instruction.data);

    const expectedMarket =
      ruleMatch.marketAccountIndex == null ? null : marketForInstruction(economicIntent, ruleMatch);
    validateCommonInstructionAccounts({
      ruleMatch,
      instruction,
      accountKeys,
      wallet,
      market: expectedMarket,
      selectedCustodyPubkey: selectedCustodyForInstruction(economicIntent, ruleMatch),
    });

    if (
      ruleMatch.name === INSTRUCTIONS.cancelTrigger.name ||
      ruleMatch.name === INSTRUCTIONS.cancelAll.name
    ) {
      if (economicIntent.operation === 'cancel_trigger_order') {
        validateCancelParameters(ruleMatch, instruction.data, economicIntent.market.marketPubkey, {
          orderSlot: economicIntent.orderSlot,
          isStopLoss: economicIntent.isStopLoss,
        });
      } else {
        const cleanupMarket =
          economicIntent.operation === 'reverse_position'
            ? economicIntent.sourceMarket.marketPubkey
            : 'market' in economicIntent
              ? economicIntent.market.marketPubkey
              : null;
        if (cleanupMarket == null) {
          throw new Error('Flash Trade transaction contains an unexpected cancel instruction.');
        }
        validateCancelParameters(ruleMatch, instruction.data, cleanupMarket);
      }
      continue;
    }

    switch (economicIntent.operation) {
      case 'open_position': {
        const primary = expectedPrimaryInstruction(economicIntent);
        if (ruleMatch.name === INSTRUCTIONS.placeTrigger.name) {
          observedTriggerOrders.push(decoded);
          break;
        }
        if (ruleMatch.name !== primary.name) {
          throw new Error('Flash Trade open transaction uses an unexpected position instruction.');
        }
        requireRawAmount(decoded.collateralRawAmount, economicIntent.collateral, 'collateral');
        requireRawAmount(decoded.sizeRawAmount, economicIntent.size, 'position size');
        if (economicIntent.tradeType === 'limit') {
          requirePrice(decoded.executionPrice, economicIntent.limitPrice ?? 0, 'limit price');
          requireOptionalPrice(
            readOraclePrice(instruction.data, 36),
            economicIntent.stopLossPrice,
            'stop-loss price',
          );
          requireOptionalPrice(
            readOraclePrice(instruction.data, 48),
            economicIntent.takeProfitPrice,
            'take-profit price',
          );
        } else {
          if (economicIntent.executionPriceLimit == null) {
            throw new Error('Flash Trade open intent is missing its execution-price limit.');
          }
          requirePrice(
            decoded.executionPrice,
            economicIntent.executionPriceLimit,
            'execution-price limit',
          );
          requirePrivilege(decoded.privilege, economicIntent.privilege ?? 'none', 'open privilege');
        }
        break;
      }
      case 'close_position':
        requirePrice(
          decoded.executionPrice,
          economicIntent.executionPriceLimit,
          'close execution-price limit',
        );
        requirePrivilege(decoded.privilege, economicIntent.privilege, 'close privilege');
        if (economicIntent.closeMode === 'partial') {
          if (economicIntent.size == null) {
            throw new Error('Flash Trade partial-close intent is missing its exact size.');
          }
          requireRawAmount(decoded.sizeRawAmount, economicIntent.size, 'close size');
        } else if (decoded.sizeRawAmount != null) {
          throw new Error(
            'Flash Trade full-close transaction unexpectedly encodes a partial size.',
          );
        }
        break;
      case 'add_collateral':
        requireRawAmount(
          decoded.collateralRawAmount,
          economicIntent.amount,
          'add-collateral amount',
        );
        break;
      case 'remove_collateral':
        requireUsdRawAmount(decoded.usdAmountRaw, economicIntent.usdAmountRaw);
        break;
      case 'place_trigger_order':
        requirePrice(decoded.triggerPrice, economicIntent.triggerPrice, 'trigger price');
        requireRawAmount(decoded.sizeRawAmount, economicIntent.size, 'trigger size');
        if (decoded.isStopLoss !== economicIntent.isStopLoss) {
          throw new Error('Flash Trade trigger transaction targets an unexpected order type.');
        }
        break;
      case 'edit_trigger_order':
        requirePrice(decoded.triggerPrice, economicIntent.triggerPrice, 'trigger price');
        requireRawAmount(decoded.sizeRawAmount, economicIntent.size, 'trigger size');
        if (decoded.orderSlot !== economicIntent.orderSlot) {
          throw new Error('Flash Trade edit transaction targets an unexpected order slot.');
        }
        if (decoded.isStopLoss !== economicIntent.isStopLoss) {
          throw new Error('Flash Trade edit transaction targets an unexpected order type.');
        }
        break;
      case 'cancel_trigger_order':
      case 'cancel_all_trigger_orders':
        throw new Error('Flash Trade cancel transaction contains an unexpected instruction.');
      case 'reverse_position':
        if (ruleMatch.name === INSTRUCTIONS.closePosition.name) {
          requirePrice(
            decoded.executionPrice,
            economicIntent.closeExecutionPriceLimit,
            'reverse close execution-price limit',
          );
          requirePrivilege(
            decoded.privilege,
            economicIntent.closePrivilege,
            'reverse close privilege',
          );
        } else if (ruleMatch.name === INSTRUCTIONS.openPosition.name) {
          requirePrice(
            decoded.executionPrice,
            economicIntent.openExecutionPriceLimit,
            'reverse open execution-price limit',
          );
          requireRawAmount(decoded.collateralRawAmount, economicIntent.collateral, 'collateral');
          requireRawAmount(decoded.sizeRawAmount, economicIntent.size, 'position size');
          requirePrivilege(
            decoded.privilege,
            economicIntent.openPrivilege,
            'reverse open privilege',
          );
        } else {
          throw new Error('Flash Trade reverse transaction contains an unexpected instruction.');
        }
        break;
    }
  }

  if (computeInstructionCount !== 1) {
    throw new Error('Flash Trade transaction must contain exactly one compute-unit limit.');
  }

  const primary = expectedPrimaryInstruction(economicIntent).name;
  const cleanupNames = new Set([INSTRUCTIONS.cancelAll.name, INSTRUCTIONS.cancelTrigger.name]);
  if (economicIntent.operation === 'open_position') {
    if (flashInstructionNames[0] !== primary) {
      throw new Error(`Flash Trade transaction does not begin with ${primary}.`);
    }
    const trailing = flashInstructionNames.slice(1);
    if (
      trailing.length !== economicIntent.triggerOrders.length ||
      trailing.some((name) => name !== INSTRUCTIONS.placeTrigger.name)
    ) {
      throw new Error('Flash Trade open transaction does not match the requested TP/SL intent.');
    }
    if (
      economicIntent.triggerOrders.some(
        (trigger) => trigger.receiveCustodyPubkey !== economicIntent.inputCustodyPubkey,
      )
    ) {
      throw new Error('Flash Trade open intent contains inconsistent trigger settlement custody.');
    }
    validateExpectedTriggerOrders(observedTriggerOrders, economicIntent.triggerOrders);
  } else if (economicIntent.operation === 'close_position' && economicIntent.closeMode === 'full') {
    const expectedCount = economicIntent.cleanupTriggerOrders ? 2 : 1;
    if (
      flashInstructionNames.length !== expectedCount ||
      flashInstructionNames[0] !== INSTRUCTIONS.closePosition.name ||
      (economicIntent.cleanupTriggerOrders && !cleanupNames.has(flashInstructionNames[1] ?? ''))
    ) {
      throw new Error('Flash Trade full-close transaction has an unexpected cleanup sequence.');
    }
  } else if (economicIntent.operation === 'reverse_position') {
    const expected = economicIntent.cleanupTriggerOrders
      ? [INSTRUCTIONS.closePosition.name, 'cleanup', INSTRUCTIONS.openPosition.name]
      : [INSTRUCTIONS.closePosition.name, INSTRUCTIONS.openPosition.name];
    const sequenceMatches = economicIntent.cleanupTriggerOrders
      ? flashInstructionNames.length === 3 &&
        flashInstructionNames[0] === expected[0] &&
        cleanupNames.has(flashInstructionNames[1] ?? '') &&
        flashInstructionNames[2] === expected[2]
      : flashInstructionNames.length === 2 &&
        flashInstructionNames[0] === expected[0] &&
        flashInstructionNames[1] === expected[1];
    if (!sequenceMatches) {
      throw new Error('Flash Trade reverse transaction must atomically close and reopen exactly.');
    }
  } else if (economicIntent.operation === 'cancel_all_trigger_orders') {
    if (flashInstructionNames.length !== 1 || !cleanupNames.has(flashInstructionNames[0] ?? '')) {
      throw new Error('Flash Trade cancel-all transaction contains unexpected instructions.');
    }
  } else if (flashInstructionNames.length !== 1 || flashInstructionNames[0] !== primary) {
    throw new Error(`Flash Trade transaction does not contain exactly one ${primary} instruction.`);
  }

  const blockhash = await rpc.isBlockhashValid(transaction.message.recentBlockhash);
  if (!blockhash.value) {
    throw new Error('Flash Trade transaction blockhash expired. Request a fresh quote.');
  }

  return {
    transaction,
    messageBase64: Buffer.from(transaction.message.serialize()).toString('base64'),
    walletSignerIndex,
    flashInstructionNames,
  };
}

export async function verifySignedFlashTradeTransaction(params: {
  unsignedTransactionBase64: string;
  signedTransactionBase64: string;
  intent: FlashTradeTransactionIntent;
  rpc?: FlashTradeRpc;
}): Promise<VerifiedFlashTradeTransaction> {
  const rpc =
    params.rpc ?? (new Connection(FLASH_MAGICBLOCK_RPC_URL, 'confirmed') as FlashTradeRpc);
  const unsigned = decodeTransaction(params.unsignedTransactionBase64);
  const signed = decodeTransaction(params.signedTransactionBase64);
  const unsignedMessage = Buffer.from(unsigned.message.serialize()).toString('base64');
  const signedMessage = Buffer.from(signed.message.serialize()).toString('base64');
  if (unsignedMessage !== signedMessage) {
    throw new Error('Wallet changed the Flash Trade transaction message.');
  }

  const signerCount = unsigned.message.header.numRequiredSignatures;
  const wallet = new PublicKey(params.intent.walletAddress);
  const walletSignerIndex = unsigned.message.staticAccountKeys
    .slice(0, signerCount)
    .findIndex((key) => key.equals(wallet));
  for (let index = 0; index < signerCount; index += 1) {
    if (index === walletSignerIndex) continue;
    if (!Buffer.from(unsigned.signatures[index]).equals(Buffer.from(signed.signatures[index]))) {
      throw new Error('Wallet changed a Flash Trade protocol signature.');
    }
  }

  return verifyFlashTradeTransaction({
    transactionBase64: params.signedTransactionBase64,
    intent: params.intent,
    requireWalletSignature: true,
    rpc,
  });
}

export async function sendAndConfirmFlashTradeTransaction(params: {
  signedTransactionBase64: string;
  timeoutMs?: number;
  rpc?: FlashTradeRpc;
}): Promise<FlashTradeSendResult> {
  const rpc =
    params.rpc ?? (new Connection(FLASH_MAGICBLOCK_RPC_URL, 'confirmed') as FlashTradeRpc);
  const transaction = decodeTransaction(params.signedTransactionBase64);
  const startedAt = Date.now();
  const signature = await rpc.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const timeoutMs = params.timeoutMs ?? FLASH_CONFIRMATION_TIMEOUT_MS;
  let polls = 0;

  for (;;) {
    const status = (await rpc.getSignatureStatuses([signature])).value[0];
    if (status?.err != null) {
      throw new Error(
        `Flash Trade transaction failed on-chain (${signature}): ${JSON.stringify(status.err)}`,
      );
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return { signature, confirmMs: Date.now() - startedAt };
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `Flash Trade confirmation timed out after ${timeoutMs}ms. Check signature ${signature} before retrying.`,
      );
    }
    polls += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, polls <= 10 ? 30 : 150));
  }
}
