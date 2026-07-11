import { ed25519 } from '@noble/curves/ed25519.js';
import { AddressLookupTableAccount, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';

import {
  broadcastRawTransaction,
  getRpcAccounts,
  getRpcSignatureStatuses,
  simulateRawTransaction,
} from '@/lib/api/offpay-api-client';
import type {
  RpcAccountsResponse,
  RpcBroadcastResponse,
  RpcSignatureStatusesResponse,
  RpcSimulationResponse,
} from '@/types/offpay-api';

import { FLASH_CONFIRMATION_TIMEOUT_MS, FLASH_V2_PROGRAM_ID } from './constants';

export interface FlashFundingIntent {
  walletAddress: string;
  expectedMint: string;
  expectedRawAmount: string;
}

export interface VerifiedFlashFundingTransaction {
  transaction: VersionedTransaction;
  messageBase64: string;
  setupInstructionNames: string[];
}

export interface FlashFundingExecutionApi {
  getAccounts(addresses: string[]): Promise<RpcAccountsResponse>;
  simulate(transactionBase64: string): Promise<RpcSimulationResponse>;
  broadcast(signedTransactionBase64: string): Promise<RpcBroadcastResponse>;
  getSignatureStatuses(signatures: string[]): Promise<RpcSignatureStatusesResponse>;
}

interface FundingInstructionRule {
  name: 'init_basket' | 'init_user_deposit_ledger' | 'delegate_basket' | 'deposit_direct';
  discriminator: Uint8Array;
  expectedData: Uint8Array | null;
  ownerAccountIndex: number;
  payerAccountIndex: number;
  accountCount: number;
}

const FLASH_PROGRAM = new PublicKey(FLASH_V2_PROGRAM_ID);
const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
const DELEGATION_PROGRAM = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);
const ALT_PROGRAM_ID = 'AddressLookupTab1e1111111111111111111111111';
const U64_MAX = (1n << 64n) - 1n;

const INSTRUCTION_RULES = {
  initBasket: fundingRule(
    'init_basket',
    'bbef8051ae465eec',
    // Canonical capacities currently emitted by the official one-shot builder.
    'bbef8051ae465eec08080804',
    0,
    1,
    4,
  ),
  initDepositLedger: fundingRule(
    'init_user_deposit_ledger',
    '5570ce9412130593',
    '5570ce941213059308',
    0,
    1,
    4,
  ),
  delegateBasket: fundingRule('delegate_basket', 'c477ba2bc5ea0fb2', 'c477ba2bc5ea0fb2', 1, 0, 11),
  deposit: fundingRule('deposit_direct', 'ceb7b208c4571b96', null, 1, 0, 12),
} as const;

const ALL_RULES: readonly FundingInstructionRule[] = Object.values(INSTRUCTION_RULES);

const defaultExecutionApi: FlashFundingExecutionApi = {
  getAccounts: (addresses) => getRpcAccounts({ addresses, network: 'mainnet' }),
  simulate: (transactionBase64) =>
    simulateRawTransaction({ transactionBase64, network: 'mainnet' }),
  broadcast: (rawTransaction) =>
    broadcastRawTransaction({
      rawTransaction,
      network: 'mainnet',
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: 'confirmed',
    }),
  getSignatureStatuses: (signatures) => getRpcSignatureStatuses({ signatures, network: 'mainnet' }),
};

function fundingRule(
  name: FundingInstructionRule['name'],
  discriminatorHex: string,
  expectedDataHex: string | null,
  ownerAccountIndex: number,
  payerAccountIndex: number,
  accountCount: number,
): FundingInstructionRule {
  return {
    name,
    discriminator: Uint8Array.from(Buffer.from(discriminatorHex, 'hex')),
    expectedData:
      expectedDataHex == null ? null : Uint8Array.from(Buffer.from(expectedDataHex, 'hex')),
    ownerAccountIndex,
    payerAccountIndex,
    accountCount,
  };
}

function decodeTransaction(transactionBase64: string): VersionedTransaction {
  if (transactionBase64.trim().length === 0) {
    throw new Error('Flash funding transaction is missing.');
  }
  try {
    return VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));
  } catch {
    throw new Error('Flash returned an invalid funding transaction.');
  }
}

function isNonZeroSignature(signature: Uint8Array | undefined): boolean {
  return signature != null && signature.some((byte) => byte !== 0);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function matchesDiscriminator(data: Uint8Array, discriminator: Uint8Array): boolean {
  return (
    data.length >= discriminator.length &&
    discriminator.every((byte, index) => data[index] === byte)
  );
}

function findRule(data: Uint8Array): FundingInstructionRule | null {
  return ALL_RULES.find((rule) => matchesDiscriminator(data, rule.discriminator)) ?? null;
}

function parseExpectedRawAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error('Flash funding amount must be an exact raw integer.');
  const amount = BigInt(value);
  if (amount <= 0n || amount > U64_MAX) {
    throw new Error('Flash funding amount is outside the valid token range.');
  }
  return amount;
}

function readU64LittleEndian(data: Uint8Array, offset: number): bigint {
  if (data.length < offset + 8) throw new Error('Flash deposit instruction is malformed.');
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(data[offset + index] ?? 0);
  }
  return value;
}

async function resolveLookupTables(
  transaction: VersionedTransaction,
  api: FlashFundingExecutionApi,
): Promise<AddressLookupTableAccount[]> {
  const lookups = transaction.message.addressTableLookups;
  if (lookups.length === 0) return [];

  const addresses = lookups.map((lookup) => lookup.accountKey.toBase58());
  const response = await api.getAccounts(addresses);
  if (response.accounts.length !== addresses.length) {
    throw new Error('Flash funding lookup-table response is incomplete.');
  }

  return response.accounts.map((record, index) => {
    const address = addresses[index];
    const dataBase64 = record?.dataBase64 ?? record?.data ?? null;
    if (
      address == null ||
      record == null ||
      dataBase64 == null ||
      record.owner !== ALT_PROGRAM_ID
    ) {
      throw new Error(`Flash funding address lookup table is unavailable: ${address ?? 'unknown'}`);
    }
    try {
      return new AddressLookupTableAccount({
        key: new PublicKey(address),
        state: AddressLookupTableAccount.deserialize(Buffer.from(dataBase64, 'base64')),
      });
    } catch {
      throw new Error(`Flash funding address lookup table is invalid: ${address}`);
    }
  });
}

function requireInstructionWallet(params: {
  rule: FundingInstructionRule;
  accountIndexes: readonly number[];
  accountKeys: ReturnType<VersionedTransaction['message']['getAccountKeys']>;
  wallet: PublicKey;
}): void {
  const ownerIndex = params.accountIndexes[params.rule.ownerAccountIndex];
  const payerIndex = params.accountIndexes[params.rule.payerAccountIndex];
  const owner = ownerIndex == null ? undefined : params.accountKeys.get(ownerIndex);
  const payer = payerIndex == null ? undefined : params.accountKeys.get(payerIndex);
  if (
    owner == null ||
    payer == null ||
    !owner.equals(params.wallet) ||
    !payer.equals(params.wallet)
  ) {
    throw new Error('Flash funding instruction owner or payer does not match the active wallet.');
  }
}

function getInstructionAccount(params: {
  accountIndexes: readonly number[];
  accountKeys: ReturnType<VersionedTransaction['message']['getAccountKeys']>;
  index: number;
}): PublicKey {
  const accountIndex = params.accountIndexes[params.index];
  const account = accountIndex == null ? undefined : params.accountKeys.get(accountIndex);
  if (account == null) throw new Error('Flash funding instruction account list is malformed.');
  return account;
}

function requireFixedProtocolAccounts(params: {
  rule: FundingInstructionRule;
  accountIndexes: readonly number[];
  accountKeys: ReturnType<VersionedTransaction['message']['getAccountKeys']>;
}): void {
  const accountAt = (index: number): PublicKey => getInstructionAccount({ ...params, index });
  if (params.accountIndexes.length !== params.rule.accountCount) {
    throw new Error(`Flash funding ${params.rule.name} account list is not canonical.`);
  }

  if (params.rule.name === 'init_basket' || params.rule.name === 'init_user_deposit_ledger') {
    if (!accountAt(3).equals(SYSTEM_PROGRAM)) {
      throw new Error(`Flash funding ${params.rule.name} system program is invalid.`);
    }
    return;
  }

  if (params.rule.name === 'delegate_basket') {
    if (
      !accountAt(7).equals(FLASH_PROGRAM) ||
      !accountAt(8).equals(FLASH_PROGRAM) ||
      !accountAt(9).equals(DELEGATION_PROGRAM) ||
      !accountAt(10).equals(SYSTEM_PROGRAM)
    ) {
      throw new Error('Flash funding delegation program accounts are invalid.');
    }
    return;
  }

  if (
    !TOKEN_PROGRAMS.has(accountAt(8).toBase58()) ||
    !accountAt(9).equals(SYSTEM_PROGRAM) ||
    !accountAt(11).equals(FLASH_PROGRAM)
  ) {
    throw new Error('Flash funding deposit program accounts are invalid.');
  }
}

export async function verifyFlashFundingTransaction(params: {
  transactionBase64: string;
  intent: FlashFundingIntent;
  requireWalletSignature?: boolean;
  api?: FlashFundingExecutionApi;
}): Promise<VerifiedFlashFundingTransaction> {
  const api = params.api ?? defaultExecutionApi;
  const transaction = decodeTransaction(params.transactionBase64);
  if (transaction.message.version !== 0) {
    throw new Error('Flash funding must return a V0 transaction.');
  }

  const wallet = new PublicKey(params.intent.walletAddress);
  const expectedMint = new PublicKey(params.intent.expectedMint);
  const expectedRawAmount = parseExpectedRawAmount(params.intent.expectedRawAmount);
  if (
    transaction.message.header.numRequiredSignatures !== 1 ||
    !transaction.message.staticAccountKeys[0]?.equals(wallet)
  ) {
    throw new Error('Flash funding must use only the active wallet as signer and fee payer.');
  }

  const walletSignature = transaction.signatures[0];
  if (params.requireWalletSignature === true) {
    const message = transaction.message.serialize();
    if (
      !isNonZeroSignature(walletSignature) ||
      !ed25519.verify(walletSignature, message, wallet.toBytes())
    ) {
      throw new Error('Flash funding transaction does not contain a valid wallet signature.');
    }
  } else if (isNonZeroSignature(walletSignature)) {
    throw new Error('Flash funding builder unexpectedly returned a wallet signature.');
  }

  const lookupTables = await resolveLookupTables(transaction, api);
  const accountKeys = transaction.message.getAccountKeys({
    addressLookupTableAccounts: lookupTables,
  });
  const seen = new Set<FundingInstructionRule['name']>();
  const setupInstructionNames: string[] = [];

  for (const instruction of transaction.message.compiledInstructions) {
    const program = accountKeys.get(instruction.programIdIndex);
    if (program == null || !program.equals(FLASH_PROGRAM)) {
      throw new Error('Flash funding transaction invokes a non-Flash program.');
    }

    const rule = findRule(instruction.data);
    if (rule == null) {
      throw new Error('Flash funding transaction contains an unexpected protocol instruction.');
    }
    if (seen.has(rule.name)) {
      throw new Error(`Flash funding transaction repeats ${rule.name}.`);
    }
    seen.add(rule.name);
    requireInstructionWallet({
      rule,
      accountIndexes: instruction.accountKeyIndexes,
      accountKeys,
      wallet,
    });
    requireFixedProtocolAccounts({
      rule,
      accountIndexes: instruction.accountKeyIndexes,
      accountKeys,
    });

    if (rule.name === 'deposit_direct') {
      if (instruction.data.length !== 16) {
        throw new Error('Flash deposit instruction is malformed.');
      }
      const mintIndex = instruction.accountKeyIndexes[4];
      const mint = mintIndex == null ? undefined : accountKeys.get(mintIndex);
      if (mint == null || !mint.equals(expectedMint)) {
        throw new Error('Flash funding transaction targets an unexpected mint.');
      }
      if (readU64LittleEndian(instruction.data, 8) !== expectedRawAmount) {
        throw new Error('Flash funding transaction amount does not match the confirmed amount.');
      }
    } else {
      if (rule.expectedData == null || !bytesEqual(instruction.data, rule.expectedData)) {
        throw new Error(`Flash funding transaction contains non-canonical ${rule.name} setup.`);
      }
      setupInstructionNames.push(rule.name);
    }
  }

  if (!seen.has('deposit_direct')) {
    throw new Error('Flash funding transaction must contain exactly one deposit.');
  }

  return {
    transaction,
    messageBase64: Buffer.from(transaction.message.serialize()).toString('base64'),
    setupInstructionNames,
  };
}

export async function verifySignedFlashFundingTransaction(params: {
  unsignedTransactionBase64: string;
  signedTransactionBase64: string;
  intent: FlashFundingIntent;
  api?: FlashFundingExecutionApi;
}): Promise<VerifiedFlashFundingTransaction> {
  const unsigned = decodeTransaction(params.unsignedTransactionBase64);
  const signed = decodeTransaction(params.signedTransactionBase64);
  if (!bytesEqual(unsigned.message.serialize(), signed.message.serialize())) {
    throw new Error('Wallet changed the Flash funding transaction message.');
  }
  if (unsigned.signatures.length !== signed.signatures.length) {
    throw new Error('Wallet changed the Flash funding signer set.');
  }

  return verifyFlashFundingTransaction({
    transactionBase64: params.signedTransactionBase64,
    intent: params.intent,
    requireWalletSignature: true,
    api: params.api,
  });
}

export async function simulateFlashFundingTransaction(params: {
  unsignedTransactionBase64: string;
  api?: FlashFundingExecutionApi;
}): Promise<void> {
  const result = await (params.api ?? defaultExecutionApi).simulate(
    params.unsignedTransactionBase64,
  );
  if (!result.success) {
    throw new Error(`Flash funding preflight failed: ${result.error ?? 'simulation failed'}`);
  }
}

export async function sendAndConfirmFlashFundingTransaction(params: {
  signedTransactionBase64: string;
  api?: FlashFundingExecutionApi;
  timeoutMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<{ signature: string; confirmMs: number }> {
  const api = params.api ?? defaultExecutionApi;
  const wait =
    params.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = Date.now();
  const { signature } = await api.broadcast(params.signedTransactionBase64);
  const timeoutMs = params.timeoutMs ?? FLASH_CONFIRMATION_TIMEOUT_MS;
  let polls = 0;

  for (;;) {
    const status = (await api.getSignatureStatuses([signature])).statuses[0];
    if (status?.err != null) {
      throw new Error(
        `Flash funding failed on-chain (${signature}): ${JSON.stringify(status.err)}`,
      );
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return { signature, confirmMs: Date.now() - startedAt };
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `Flash funding confirmation timed out. Check signature ${signature} before retrying.`,
      );
    }
    polls += 1;
    await wait(polls <= 8 ? 250 : 500);
  }
}
