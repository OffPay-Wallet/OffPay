import { Buffer } from 'buffer';

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';

import { zeroOutBytes } from '@/lib/crypto/offpay-api-auth';
import { runCryptoTask } from '@/lib/crypto/crypto-scheduler';
import { getOfflineTokenDecimals, getOfflineTokenMetadata } from '@/lib/offline/offline-token-metadata';
import {
  assertBase58PublicKey,
  assertCachedNonce,
  assertPositiveAmount,
  isOfflinePayloadRecord,
} from '@/lib/offline/offline-validators';
import {
  getReadyOfflinePaymentSlot,
  lockOfflinePaymentSlotForTx,
  markOfflinePaymentSlotFailedForTx,
  markOfflinePaymentSlotSettledForTx,
  markOfflinePaymentSlotSettlingForTx,
} from '@/lib/offline/offline-payment-slots';
import { enqueuePendingPaymentBackup } from '@/lib/payments/pending-backup-queue';
import {
  deleteSecureStoreItem,
  getSecureStoreItem,
  setSecureStoreItem,
} from '@/lib/secure-store/secure-store-chunks';
import { getStoredWalletSigningMaterialWithAuth } from '@/lib/wallet/secure-wallet-store';
import { getOrDeriveSigningSeed } from '@/lib/wallet/signing-seed-cache';
import {
  PRIVATE_PAYMENT_LAYER_LABEL,
  STABLECOIN_ONLY_PAYMENT_MESSAGE,
  isSupportedStablecoinToken,
} from '@/lib/policy/stablecoin-policy';
import { decimalInputToAtomicAmount } from '@/lib/policy/token-amounts';
import { decodeSigningSeedFromPrivateKey, deriveSigningSeedFromMnemonic } from '@/lib/wallet/wallet';

import type { WalletMode } from '@/store/preferencesStore';
import type { OffpayNetwork } from '@/types/offpay-api';

export type { OfflinePaymentRequest, ParsedOfflineQrPayload } from '@/lib/offline/offline-validators';
export { isNativeOfflineSolToken } from '@/lib/offline/offline-validators';
export {
  buildOfflinePaymentRequestQr,
  buildOffpayReceiveRequestQr,
  buildSolanaPayRequestQr,
  parseOfflineQrPayload,
} from '@/lib/offline/offline-qr';

const NONCE_STATE_KEY_PREFIX = 'offpay_offline_nonce_v1';
const NONCE_STATE_VERSION = 1;
const NONCE_STALE_MS = 24 * 60 * 60 * 1000;
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const RECENT_BLOCKHASHES_SYSVAR_ID = 'SysvarRecentB1ockHashes11111111111111111111';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const PDA_MARKER = 'ProgramDerivedAddress';
const ADVANCE_NONCE_ACCOUNT_INSTRUCTION = 4;
const TRANSFER_CHECKED_INSTRUCTION = 12;
const CREATE_ASSOCIATED_TOKEN_ACCOUNT_IDEMPOTENT_INSTRUCTION = 1;

export type OfflineNonceLifecycleStatus =
  | 'ready'
  | 'locked'
  | 'settling'
  | 'settled'
  | 'stale'
  | 'error';

export interface OfflineNonceState {
  version: 1;
  walletAddress: string;
  network: OffpayNetwork;
  nonceAccount: string;
  nonceAuthority: string;
  cachedNonce: string;
  status: OfflineNonceLifecycleStatus;
  updatedAt: number;
  lockedTxId?: string | null;
  errorMessage?: string | null;
}

export interface OfflineNonceReadiness {
  status: 'ready' | 'setup_required';
  message: string;
  nonceState: OfflineNonceState | null;
}

interface ShortVecReadResult {
  value: number;
  offset: number;
}

interface ParsedInstruction {
  programIdIndex: number;
  accountIndexes: number[];
  data: Uint8Array;
}

interface ParsedSignedTransaction {
  transaction: Uint8Array;
  message: Uint8Array;
  requiredSignerCount: number;
  accountKeys: string[];
  instructions: ParsedInstruction[];
}

export interface OfflineSignedTransactionVerification {
  txId: string;
  signedBlob: string;
  requiredSigners: string[];
  nonceAccount: string;
  nonceAuthority: string;
  recipientVerified: boolean;
  amountVerified: boolean;
  instructionCount: number;
}

export type OfflineExpectedAmountUnit = 'raw' | 'display';

export interface BuiltOfflineSolPayment {
  signedTransaction: string;
  rawAmount: string;
  verification: OfflineSignedTransactionVerification;
}

export interface BuiltOfflineStablecoinPayment {
  signedTransaction: string;
  rawAmount: string;
  tokenMint: string;
  tokenSymbol: 'USDC' | 'USDT';
  nonceAccount: string;
  recipientTokenAccount: string;
  verification: OfflineSignedTransactionVerification;
}

interface OfflineStablecoinLocalContext {
  mint: string;
  symbol: 'USDC' | 'USDT';
  name: string;
  decimals: number;
  programId: string;
  senderTokenAccount: string;
  recipientTokenAccount: string;
}

interface OfflineNonceForSigning {
  nonceAccount: string;
  nonceAuthority: string;
  nonceValue: string;
}

function nonceStateKey(walletAddress: string, network: OffpayNetwork): string {
  return `${NONCE_STATE_KEY_PREFIX}_${network}_${walletAddress}`;
}

async function assertOfflineStablecoinToken(
  network: OffpayNetwork,
  token: string | null | undefined,
): Promise<void> {
  const metadata = await getOfflineTokenMetadata(network, token);
  if (
    metadata == null ||
    !isSupportedStablecoinToken({
      network,
      token: metadata.mint,
      symbol: metadata.symbol,
    })
  ) {
    throw new Error(
      `${STABLECOIN_ONLY_PAYMENT_MESSAGE} ${PRIVATE_PAYMENT_LAYER_LABEL} handles the private/offline layer; SOL is reserved for network fees.`,
    );
  }
}

function normalizeNonceState(value: unknown): OfflineNonceState | null {
  if (!isOfflinePayloadRecord(value)) return null;
  if (value.version !== NONCE_STATE_VERSION) return null;
  if (value.network !== 'mainnet' && value.network !== 'devnet') return null;
  if (
    value.status !== 'ready' &&
    value.status !== 'locked' &&
    value.status !== 'settling' &&
    value.status !== 'settled' &&
    value.status !== 'stale' &&
    value.status !== 'error'
  ) {
    return null;
  }
  if (
    typeof value.walletAddress !== 'string' ||
    typeof value.nonceAccount !== 'string' ||
    typeof value.nonceAuthority !== 'string' ||
    typeof value.cachedNonce !== 'string' ||
    typeof value.updatedAt !== 'number'
  ) {
    return null;
  }

  try {
    return {
      version: NONCE_STATE_VERSION,
      walletAddress: assertBase58PublicKey(value.walletAddress, 'Wallet address'),
      network: value.network,
      nonceAccount: assertBase58PublicKey(value.nonceAccount, 'Nonce account'),
      nonceAuthority: assertBase58PublicKey(value.nonceAuthority, 'Nonce authority'),
      cachedNonce: assertCachedNonce(value.cachedNonce),
      status: value.status,
      updatedAt: value.updatedAt,
      lockedTxId: typeof value.lockedTxId === 'string' ? value.lockedTxId : null,
      errorMessage: typeof value.errorMessage === 'string' ? value.errorMessage : null,
    };
  } catch {
    return null;
  }
}

export function isOfflineNonceStateStale(state: OfflineNonceState): boolean {
  return Date.now() - state.updatedAt > NONCE_STALE_MS;
}

export async function loadOfflineNonceState(params: {
  walletAddress: string;
  network: OffpayNetwork;
}): Promise<OfflineNonceState | null> {
  const raw = await getSecureStoreItem(nonceStateKey(params.walletAddress, params.network));
  if (raw == null || raw.length === 0) return null;

  try {
    return normalizeNonceState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveOfflineNonceState(params: {
  walletAddress: string;
  network: OffpayNetwork;
  nonceAccount: string;
  nonceAuthority: string;
  cachedNonce: string;
  status?: OfflineNonceLifecycleStatus;
}): Promise<OfflineNonceState> {
  const state: OfflineNonceState = {
    version: NONCE_STATE_VERSION,
    walletAddress: assertBase58PublicKey(params.walletAddress, 'Wallet address'),
    network: params.network,
    nonceAccount: assertBase58PublicKey(params.nonceAccount, 'Nonce account'),
    nonceAuthority: assertBase58PublicKey(params.nonceAuthority, 'Nonce authority'),
    cachedNonce: assertCachedNonce(params.cachedNonce),
    status: params.status ?? 'ready',
    updatedAt: Date.now(),
    lockedTxId: null,
    errorMessage: null,
  };

  await setSecureStoreItem(
    nonceStateKey(state.walletAddress, state.network),
    JSON.stringify(state),
  );
  return state;
}

async function persistOfflineNonceState(state: OfflineNonceState): Promise<OfflineNonceState> {
  const normalized: OfflineNonceState = {
    version: NONCE_STATE_VERSION,
    walletAddress: assertBase58PublicKey(state.walletAddress, 'Wallet address'),
    network: state.network,
    nonceAccount: assertBase58PublicKey(state.nonceAccount, 'Nonce account'),
    nonceAuthority: assertBase58PublicKey(state.nonceAuthority, 'Nonce authority'),
    cachedNonce: assertCachedNonce(state.cachedNonce),
    status: state.status,
    updatedAt: state.updatedAt,
    lockedTxId: state.lockedTxId ?? null,
    errorMessage: state.errorMessage ?? null,
  };

  await setSecureStoreItem(
    nonceStateKey(normalized.walletAddress, normalized.network),
    JSON.stringify(normalized),
  );
  return normalized;
}

async function assertNonceCanBeLocked(params: {
  walletAddress: string;
  network: OffpayNetwork;
  verification: OfflineSignedTransactionVerification;
}): Promise<OfflineNonceState> {
  let current = await loadOfflineNonceState(params);
  if (current == null) {
    const poolSlot = await getReadyOfflinePaymentSlot(params);
    if (
      poolSlot != null &&
      poolSlot.nonceAccount === params.verification.nonceAccount &&
      poolSlot.nonceAuthority === params.verification.nonceAuthority &&
      poolSlot.nonceValue != null
    ) {
      current = await saveOfflineNonceState({
        walletAddress: params.walletAddress,
        network: params.network,
        nonceAccount: poolSlot.nonceAccount,
        nonceAuthority: poolSlot.nonceAuthority,
        cachedNonce: poolSlot.nonceValue,
      });
    }
  }
  if (current == null) {
    throw new Error('Save durable nonce state before queueing an offline payment.');
  }

  if (current.status === 'locked' || current.status === 'settling') {
    throw new Error(
      'A durable nonce is already locked by a pending offline payment. Settle it before signing another offline payment.',
    );
  }

  if (current.status === 'settled') {
    throw new Error('Refresh durable nonce state before signing another offline payment.');
  }

  if (
    current.nonceAccount !== params.verification.nonceAccount ||
    current.nonceAuthority !== params.verification.nonceAuthority
  ) {
    throw new Error('Signed offline transaction does not match the cached durable nonce account.');
  }

  return current;
}

export async function lockOfflineNonceForPayment(params: {
  walletAddress: string;
  network: OffpayNetwork;
  verification: OfflineSignedTransactionVerification;
}): Promise<OfflineNonceState> {
  const current = await assertNonceCanBeLocked(params);
  return persistOfflineNonceState({
    ...current,
    status: 'locked',
    lockedTxId: params.verification.txId,
    errorMessage: null,
    updatedAt: Date.now(),
  });
}

export async function markOfflineNonceSettlingForTx(params: {
  walletAddress: string;
  network: OffpayNetwork;
  txId: string;
}): Promise<OfflineNonceState | null> {
  await markOfflinePaymentSlotSettlingForTx(params).catch(() => null);
  const current = await loadOfflineNonceState(params);
  if (current == null || current.lockedTxId !== params.txId) return current;

  return persistOfflineNonceState({
    ...current,
    status: 'settling',
    errorMessage: null,
    updatedAt: Date.now(),
  });
}

export async function markOfflineNonceSettledForTx(params: {
  walletAddress: string;
  network: OffpayNetwork;
  txId: string;
}): Promise<OfflineNonceState | null> {
  await markOfflinePaymentSlotSettledForTx(params).catch(() => null);
  const current = await loadOfflineNonceState(params);
  if (current == null || current.lockedTxId !== params.txId) return current;

  return persistOfflineNonceState({
    ...current,
    status: 'settled',
    errorMessage: null,
    updatedAt: Date.now(),
  });
}

export async function markOfflineNonceSettlementFailedForTx(params: {
  walletAddress: string;
  network: OffpayNetwork;
  txId: string;
  errorMessage: string;
}): Promise<OfflineNonceState | null> {
  await markOfflinePaymentSlotFailedForTx(params).catch(() => null);
  const current = await loadOfflineNonceState(params);
  if (current == null || current.lockedTxId !== params.txId) return current;

  return persistOfflineNonceState({
    ...current,
    status: 'locked',
    errorMessage: params.errorMessage,
    updatedAt: Date.now(),
  });
}

export async function clearOfflineNonceState(params: {
  walletAddress: string;
  network: OffpayNetwork;
}): Promise<void> {
  await deleteSecureStoreItem(nonceStateKey(params.walletAddress, params.network));
}

export async function getOfflineNonceReadiness(params: {
  walletAddress: string;
  network: OffpayNetwork;
  walletMode: WalletMode;
}): Promise<OfflineNonceReadiness> {
  if (params.walletMode !== 'offline') {
    return {
      status: 'ready',
      message: 'Durable nonce setup is not required while the wallet is in online mode.',
      nonceState: null,
    };
  }

  const readySlot = await getReadyOfflinePaymentSlot(params);
  if (readySlot != null && readySlot.nonceValue != null) {
    return {
      status: 'ready',
      message: 'Offline payment slots are ready for cached stablecoin requests.',
      nonceState: {
        version: NONCE_STATE_VERSION,
        walletAddress: params.walletAddress,
        network: params.network,
        nonceAccount: readySlot.nonceAccount,
        nonceAuthority: readySlot.nonceAuthority,
        cachedNonce: readySlot.nonceValue,
        status: 'ready',
        updatedAt: readySlot.updatedAt,
        lockedTxId: null,
        errorMessage: null,
      },
    };
  }

  const nonceState = await loadOfflineNonceState(params);
  if (nonceState == null) {
    return {
      status: 'setup_required',
      message: 'Go online once to prepare offline payment slots before sending offline.',
      nonceState: null,
    };
  }

  if (nonceState.status === 'locked' || nonceState.status === 'settling') {
    return {
      status: 'setup_required',
      message:
        'A durable nonce is locked by a pending offline payment. Settle it before signing another offline payment.',
      nonceState,
    };
  }

  if (nonceState.status === 'error') {
    return {
      status: 'setup_required',
      message: nonceState.errorMessage ?? 'Durable nonce setup needs recovery.',
      nonceState,
    };
  }

  if (nonceState.status === 'settled') {
    return {
      status: 'setup_required',
      message:
        'The previous durable nonce was settled. Refresh and save a new nonce before signing another offline payment.',
      nonceState,
    };
  }

  return {
    status: 'ready',
    message: isOfflineNonceStateStale(nonceState)
      ? 'Durable nonce is cached but older than 24 hours. Refresh before large offline payments.'
      : 'Durable nonce cache is ready for offline requests.',
    nonceState,
  };
}

function readShortVec(bytes: Uint8Array, startOffset: number): ShortVecReadResult {
  let offset = startOffset;
  let value = 0;
  let shift = 0;

  while (offset < bytes.length) {
    const current = bytes[offset] ?? 0;
    value |= (current & 0x7f) << shift;
    offset += 1;

    if ((current & 0x80) === 0) {
      return { value, offset };
    }

    shift += 7;
    if (shift > 28) break;
  }

  throw new Error('Unable to decode Solana transaction length prefix.');
}

function encodeShortVecLength(length: number): number[] {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error('Invalid Solana compact length.');
  }

  const encoded: number[] = [];
  let remaining = length;
  do {
    let current = remaining & 0x7f;
    remaining >>= 7;
    if (remaining > 0) current |= 0x80;
    encoded.push(current);
  } while (remaining > 0);

  return encoded;
}

function assertRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(`Malformed offline transaction: ${label} is out of bounds.`);
  }
}

function parseCompiledInstruction(
  message: Uint8Array,
  startOffset: number,
): { instruction: ParsedInstruction; offset: number } {
  let cursor = startOffset;
  assertRange(message, cursor, 1, 'instruction program id');
  const programIdIndex = message[cursor] ?? 0;
  cursor += 1;

  const accountsLength = readShortVec(message, cursor);
  cursor = accountsLength.offset;
  assertRange(message, cursor, accountsLength.value, 'instruction account indexes');
  const accountIndexes = Array.from(message.subarray(cursor, cursor + accountsLength.value));
  cursor += accountsLength.value;

  const dataLength = readShortVec(message, cursor);
  cursor = dataLength.offset;
  assertRange(message, cursor, dataLength.value, 'instruction data');
  const data = message.subarray(cursor, cursor + dataLength.value);
  cursor += dataLength.value;

  return {
    instruction: {
      programIdIndex,
      accountIndexes,
      data,
    },
    offset: cursor,
  };
}

function decodeSignedTransactionPayload(payload: string): Uint8Array {
  const normalized = payload.trim();
  if (normalized.length === 0) {
    throw new Error('Offline signed transaction is missing.');
  }

  const base64Candidate = /^[A-Za-z0-9+/]+={0,2}$/.test(normalized) && normalized.length % 4 === 0;
  if (base64Candidate) {
    const decoded = Uint8Array.from(Buffer.from(normalized, 'base64'));
    if (decoded.length > 0) return decoded;
  }

  try {
    return bs58.decode(normalized);
  } catch {
    throw new Error('Offline signed transaction must be base64 or base58 encoded.');
  }
}

function parseSignedTransaction(payload: string): ParsedSignedTransaction {
  const transaction = decodeSignedTransactionPayload(payload);
  const signatureCount = readShortVec(transaction, 0);
  const signaturesOffset = signatureCount.offset;
  const messageOffset = signaturesOffset + signatureCount.value * 64;

  assertRange(transaction, signaturesOffset, signatureCount.value * 64, 'signatures');
  assertRange(transaction, messageOffset, transaction.length - messageOffset, 'message');

  const message = transaction.subarray(messageOffset);
  let cursor = 0;
  if ((message[cursor] ?? 0) & 0x80) {
    const version = (message[cursor] ?? 0) & 0x7f;
    if (version !== 0) {
      throw new Error(`Unsupported offline transaction version: ${version}.`);
    }
    cursor += 1;
  }

  assertRange(message, cursor, 3, 'message header');
  const requiredSignerCount = message[cursor] ?? 0;
  cursor += 3;

  const accountKeyCount = readShortVec(message, cursor);
  cursor = accountKeyCount.offset;
  assertRange(message, cursor, accountKeyCount.value * 32, 'account keys');
  const accountKeys = Array.from({ length: accountKeyCount.value }, (_, index) => {
    const start = cursor + index * 32;
    return bs58.encode(message.subarray(start, start + 32));
  });
  cursor += accountKeyCount.value * 32;

  assertRange(message, cursor, 32, 'recent blockhash');
  cursor += 32;

  const instructionCount = readShortVec(message, cursor);
  cursor = instructionCount.offset;
  const instructions: ParsedInstruction[] = [];
  for (let index = 0; index < instructionCount.value; index += 1) {
    const parsed = parseCompiledInstruction(message, cursor);
    instructions.push(parsed.instruction);
    cursor = parsed.offset;
  }

  if (signatureCount.value < requiredSignerCount) {
    throw new Error('Offline transaction is missing required signature slots.');
  }
  if (instructions.length === 0) {
    throw new Error('Offline transaction contains no instructions.');
  }

  for (let index = 0; index < requiredSignerCount; index += 1) {
    const signature = transaction.subarray(
      signaturesOffset + index * 64,
      signaturesOffset + (index + 1) * 64,
    );
    if (signature.every((byte) => byte === 0)) {
      throw new Error('Offline transaction contains an empty required signature.');
    }
    const publicKey = bs58.decode(accountKeys[index] ?? '');
    if (!ed25519.verify(signature, message, publicKey)) {
      throw new Error('Offline transaction signature verification failed.');
    }
  }

  return {
    transaction,
    message,
    requiredSignerCount,
    accountKeys,
    instructions,
  };
}

function u32FromLittleEndian(data: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > data.length) return null;
  return (
    (data[offset] ?? 0) |
    ((data[offset + 1] ?? 0) << 8) |
    ((data[offset + 2] ?? 0) << 16) |
    ((data[offset + 3] ?? 0) << 24)
  );
}

function u64FromLittleEndian(data: Uint8Array, offset: number): bigint | null {
  if (offset < 0 || offset + 8 > data.length) return null;

  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(data[offset + index] ?? 0) << BigInt(index * 8);
  }
  return value;
}

function u32ToLittleEndian(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

function u64ToLittleEndian(value: bigint): number[] {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error('Offline payment amount is outside the supported u64 range.');
  }

  return Array.from({ length: 8 }, (_, index) => Number((value >> BigInt(index * 8)) & 0xffn));
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function compactArray(items: Uint8Array[]): Uint8Array {
  return concatBytes([Uint8Array.from(encodeShortVecLength(items.length)), ...items]);
}

function publicKeyBytes(value: string, label: string): Uint8Array {
  return bs58.decode(assertBase58PublicKey(value, label));
}

function isPointOnEd25519Curve(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromBytes(bytes);
    return true;
  } catch {
    return false;
  }
}

function createProgramAddress(seeds: Uint8Array[], programId: string): string {
  const programIdBytes = publicKeyBytes(programId, 'Program id');
  for (const seed of seeds) {
    if (seed.length > 32) {
      throw new Error('Solana PDA seed is too long.');
    }
  }

  const digest = sha256(
    concatBytes([...seeds, programIdBytes, Uint8Array.from(Buffer.from(PDA_MARKER, 'utf8'))]),
  );
  if (isPointOnEd25519Curve(digest)) {
    throw new Error('Solana PDA derivation resolved to an on-curve address.');
  }

  return bs58.encode(digest);
}

function findProgramAddress(seeds: Uint8Array[], programId: string): string {
  for (let bump = 255; bump >= 0; bump -= 1) {
    try {
      return createProgramAddress([...seeds, Uint8Array.from([bump])], programId);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== 'Solana PDA derivation resolved to an on-curve address.'
      ) {
        throw error;
      }
    }
  }

  throw new Error('Unable to derive a Solana PDA for the associated token account.');
}

function deriveAssociatedTokenAddress(params: {
  owner: string;
  mint: string;
  tokenProgramId: string;
}): string {
  return findProgramAddress(
    [
      publicKeyBytes(params.owner, 'Token account owner'),
      publicKeyBytes(params.tokenProgramId, 'Token program'),
      publicKeyBytes(params.mint, 'Token mint'),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

function compiledInstruction(params: {
  programIdIndex: number;
  accountIndexes: number[];
  data: number[];
}): Uint8Array {
  return concatBytes([
    Uint8Array.from([params.programIdIndex]),
    Uint8Array.from(encodeShortVecLength(params.accountIndexes.length)),
    Uint8Array.from(params.accountIndexes),
    Uint8Array.from(encodeShortVecLength(params.data.length)),
    Uint8Array.from(params.data),
  ]);
}

async function deriveSigningSeedForOfflinePayment(params: {
  walletId?: string | null;
  walletAddress: string;
}): Promise<Uint8Array> {
  return getOrDeriveSigningSeed({
    walletAddress: params.walletAddress,
    derive: async () => {
      const signingMaterial = await getStoredWalletSigningMaterialWithAuth(
        params.walletId ?? undefined,
      );
      const mnemonic = signingMaterial?.mnemonic ?? null;
      const privateKey = signingMaterial?.privateKey ?? null;

      let seed: Uint8Array | null = null;
      if (mnemonic != null && mnemonic.length > 0) {
        seed = await deriveSigningSeedFromMnemonic(mnemonic);
      } else if (privateKey != null && privateKey.length > 0) {
        seed = decodeSigningSeedFromPrivateKey(privateKey);
      }

      if (seed == null) {
        throw new Error('No wallet signing material is available for offline transaction construction.');
      }

      // Verify before caching so a corrupt/mismatched private key
      // never poisons the cache for the rest of the unlocked
      // session.
      const derivedPublicKey = ed25519.getPublicKey(seed);
      try {
        if (bs58.encode(derivedPublicKey) !== params.walletAddress) {
          zeroOutBytes(seed);
          throw new Error('Stored signing material does not match the active wallet.');
        }
      } finally {
        zeroOutBytes(derivedPublicKey);
      }

      return seed;
    },
  });
}

function buildStablecoinDurableNonceMessage(params: {
  walletAddress: string;
  recipient: string;
  nonceAccount: string;
  cachedNonce: string;
  senderTokenAccount: string;
  recipientTokenAccount: string;
  mint: string;
  tokenProgramId: string;
  rawAmount: bigint;
  decimals: number;
}): Uint8Array {
  const accountKeys = [
    publicKeyBytes(params.walletAddress, 'Wallet address'),
    publicKeyBytes(params.nonceAccount, 'Nonce account'),
    publicKeyBytes(params.senderTokenAccount, 'Sender token account'),
    publicKeyBytes(params.recipientTokenAccount, 'Recipient token account'),
    publicKeyBytes(params.recipient, 'Offline recipient'),
    publicKeyBytes(params.mint, 'Stablecoin mint'),
    publicKeyBytes(RECENT_BLOCKHASHES_SYSVAR_ID, 'Recent blockhashes sysvar'),
    publicKeyBytes(SYSTEM_PROGRAM_ID, 'System program'),
    publicKeyBytes(ASSOCIATED_TOKEN_PROGRAM_ID, 'Associated token program'),
    publicKeyBytes(params.tokenProgramId, 'Token program'),
  ];

  const nonceAdvanceInstruction = compiledInstruction({
    programIdIndex: 7,
    accountIndexes: [1, 6, 0],
    data: u32ToLittleEndian(ADVANCE_NONCE_ACCOUNT_INSTRUCTION),
  });
  const createRecipientTokenAccountInstruction = compiledInstruction({
    programIdIndex: 8,
    accountIndexes: [0, 3, 4, 5, 7, 9],
    data: [CREATE_ASSOCIATED_TOKEN_ACCOUNT_IDEMPOTENT_INSTRUCTION],
  });
  const transferCheckedInstruction = compiledInstruction({
    programIdIndex: 9,
    accountIndexes: [2, 5, 3, 0],
    data: [TRANSFER_CHECKED_INSTRUCTION, ...u64ToLittleEndian(params.rawAmount), params.decimals],
  });

  return concatBytes([
    Uint8Array.from([1, 0, 6]),
    compactArray(accountKeys),
    publicKeyBytes(params.cachedNonce, 'Cached durable nonce'),
    compactArray([
      nonceAdvanceInstruction,
      createRecipientTokenAccountInstruction,
      transferCheckedInstruction,
    ]),
  ]);
}

function signedTransactionFromMessage(params: {
  message: Uint8Array;
  signingSeed: Uint8Array;
}): string {
  const signature = ed25519.sign(params.message, params.signingSeed);
  try {
    return Buffer.from(
      concatBytes([Uint8Array.from(encodeShortVecLength(1)), signature, params.message]),
    ).toString('base64');
  } finally {
    zeroOutBytes(signature);
  }
}

function instructionContainsAmount(data: Uint8Array, amount: bigint): boolean {
  for (let offset = 0; offset <= data.length - 8; offset += 1) {
    if (u64FromLittleEndian(data, offset) === amount) return true;
  }

  return false;
}

async function atomicAmountFromText(params: {
  value: string | null;
  unit: OfflineExpectedAmountUnit;
  network: OffpayNetwork;
  token?: string | null;
}): Promise<bigint | null> {
  const { value, unit, token } = params;
  if (value == null || value.length === 0) return null;
  if (unit === 'raw') {
    if (!/^\d+$/.test(value)) {
      throw new Error(
        'Signed offline transaction verification requires a raw integer expected amount.',
      );
    }
    return BigInt(value);
  }

  const decimals = await getOfflineTokenDecimals(params.network, token);
  if (decimals == null) {
    throw new Error(
      'Decimal offline amounts require a known token mint with cached decimals. Use a raw integer amount, or use a token mint that OffPay has already seen online on this network.',
    );
  }

  const atomicAmount = decimalInputToAtomicAmount(value, decimals);
  if (atomicAmount == null || BigInt(atomicAmount) <= 0n) {
    throw new Error('Offline payment amount must be greater than zero.');
  }

  return BigInt(atomicAmount);
}
function buildDeterministicUuid(bytes: Uint8Array): string {
  const digest = sha256(bytes);
  const uuidBytes = Uint8Array.from(digest.slice(0, 16));
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
  const hex = Array.from(uuidBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function verifyOfflineSignedTransaction(params: {
  signedTransaction: string;
  network: OffpayNetwork;
  expectedRecipient?: string | null;
  expectedAmount?: string | null;
  expectedAmountUnit?: OfflineExpectedAmountUnit;
  expectedToken?: string | null;
}): Promise<OfflineSignedTransactionVerification> {
  await assertOfflineStablecoinToken(params.network, params.expectedToken);

  const parsed = parseSignedTransaction(params.signedTransaction);
  const firstInstruction = parsed.instructions[0];
  if (firstInstruction == null) {
    throw new Error('Offline transaction contains no instructions.');
  }

  const firstProgramId = parsed.accountKeys[firstInstruction.programIdIndex];
  if (firstProgramId !== SYSTEM_PROGRAM_ID) {
    throw new Error('Offline transaction must start with SystemProgram.nonceAdvance.');
  }
  if (u32FromLittleEndian(firstInstruction.data, 0) !== ADVANCE_NONCE_ACCOUNT_INSTRUCTION) {
    throw new Error('Offline transaction first instruction is not nonceAdvance.');
  }

  const nonceAccount = parsed.accountKeys[firstInstruction.accountIndexes[0] ?? -1];
  const nonceAuthority = parsed.accountKeys[firstInstruction.accountIndexes[2] ?? -1];
  if (nonceAccount == null || nonceAuthority == null) {
    throw new Error('Offline nonceAdvance instruction is missing required accounts.');
  }

  const expectedRecipient =
    params.expectedRecipient != null && params.expectedRecipient.trim().length > 0
      ? assertBase58PublicKey(params.expectedRecipient, 'Expected recipient')
      : null;
  const recipientVerified =
    expectedRecipient == null || parsed.accountKeys.includes(expectedRecipient);
  if (!recipientVerified) {
    throw new Error('Offline transaction does not include the expected recipient.');
  }

  const normalizedAmount = assertPositiveAmount(params.expectedAmount ?? null);
  const amount = await atomicAmountFromText({
    value: normalizedAmount,
    unit: params.expectedAmountUnit ?? 'raw',
    network: params.network,
    token: params.expectedToken,
  });
  const amountVerified =
    amount == null ||
    parsed.instructions
      .slice(1)
      .some((instruction) => instructionContainsAmount(instruction.data, amount));
  if (!amountVerified) {
    throw new Error('Offline transaction does not encode the expected raw amount.');
  }

  return {
    txId: buildDeterministicUuid(parsed.transaction),
    signedBlob: Buffer.from(parsed.transaction).toString('base64'),
    requiredSigners: parsed.accountKeys.slice(0, parsed.requiredSignerCount),
    nonceAccount,
    nonceAuthority,
    recipientVerified,
    amountVerified,
    instructionCount: parsed.instructions.length,
  };
}

export async function buildSignedNativeSolOfflinePayment(params: {
  walletAddress: string;
  walletId?: string | null;
  network: OffpayNetwork;
  recipient: string;
  amount: string;
  token?: string | null;
}): Promise<BuiltOfflineSolPayment> {
  void params;
  throw new Error(
    'Offline payment construction is stablecoin-only. Prepare USDC or USDT payment slots before signing offline sends.',
  );
}

async function getLocalOfflineStablecoinContext(params: {
  walletAddress: string;
  network: OffpayNetwork;
  recipient: string;
  token: string;
}): Promise<OfflineStablecoinLocalContext> {
  const metadata = await getOfflineTokenMetadata(params.network, params.token);
  if (metadata == null) {
    throw new Error(
      'This token is not available in the offline token cache. Go online once to refresh wallet tokens.',
    );
  }

  const symbol = metadata.symbol === 'USDC' || metadata.symbol === 'USDT' ? metadata.symbol : null;
  if (
    symbol == null ||
    !isSupportedStablecoinToken({
      network: params.network,
      token: metadata.mint,
      symbol,
    })
  ) {
    throw new Error(STABLECOIN_ONLY_PAYMENT_MESSAGE);
  }

  const tokenProgramId =
    metadata.programId != null && metadata.programId.trim().length > 0
      ? assertBase58PublicKey(metadata.programId, 'Token program')
      : TOKEN_PROGRAM_ID;
  const senderTokenAccount = deriveAssociatedTokenAddress({
    owner: params.walletAddress,
    mint: metadata.mint,
    tokenProgramId,
  });
  const recipientTokenAccount = deriveAssociatedTokenAddress({
    owner: params.recipient,
    mint: metadata.mint,
    tokenProgramId,
  });

  return {
    mint: metadata.mint,
    symbol,
    name: metadata.name,
    decimals: metadata.decimals,
    programId: tokenProgramId,
    senderTokenAccount,
    recipientTokenAccount,
  };
}

async function getReadyOfflineNonceForSigning(params: {
  walletAddress: string;
  network: OffpayNetwork;
}): Promise<OfflineNonceForSigning> {
  const slot = await getReadyOfflinePaymentSlot(params);
  if (slot != null && slot.nonceValue != null) {
    return {
      nonceAccount: slot.nonceAccount,
      nonceAuthority: slot.nonceAuthority,
      nonceValue: slot.nonceValue,
    };
  }

  const nonceState = await loadOfflineNonceState(params);
  if (
    nonceState != null &&
    nonceState.status === 'ready' &&
    nonceState.cachedNonce.trim().length > 0
  ) {
    return {
      nonceAccount: nonceState.nonceAccount,
      nonceAuthority: nonceState.nonceAuthority,
      nonceValue: nonceState.cachedNonce,
    };
  }

  throw new Error('Go online once to prepare offline payment slots before signing.');
}

export async function buildSignedStablecoinOfflinePayment(params: {
  walletAddress: string;
  walletId?: string | null;
  network: OffpayNetwork;
  recipient: string;
  amount: string;
  token: string;
}): Promise<BuiltOfflineStablecoinPayment> {
  const recipient = assertBase58PublicKey(params.recipient, 'Offline recipient');
  const context = await getLocalOfflineStablecoinContext({
    walletAddress: params.walletAddress,
    network: params.network,
    recipient,
    token: params.token,
  });
  const nonce = await getReadyOfflineNonceForSigning({
    walletAddress: params.walletAddress,
    network: params.network,
  });

  const rawAmount = decimalInputToAtomicAmount(params.amount, context.decimals);
  if (rawAmount == null || BigInt(rawAmount) <= 0n) {
    throw new Error('Offline payment amount must be greater than zero.');
  }

  const signingSeed = await deriveSigningSeedForOfflinePayment({
    walletId: params.walletId,
    walletAddress: params.walletAddress,
  });
  try {
    // Cache hits skip per-derive verification, so re-check here as
    // a defense-in-depth guard. The check is ~5ms (one
    // ed25519.getPublicKey scalarmult) and runs once per offline
    // payment, not per loop iteration.
    const derivedPublicKey = ed25519.getPublicKey(signingSeed);
    try {
      if (bs58.encode(derivedPublicKey) !== params.walletAddress) {
        throw new Error('Stored signing material does not match the active wallet.');
      }
    } finally {
      zeroOutBytes(derivedPublicKey);
    }

    const message = buildStablecoinDurableNonceMessage({
      walletAddress: params.walletAddress,
      recipient,
      nonceAccount: nonce.nonceAccount,
      cachedNonce: nonce.nonceValue,
      senderTokenAccount: context.senderTokenAccount,
      recipientTokenAccount: context.recipientTokenAccount,
      mint: context.mint,
      tokenProgramId: context.programId,
      rawAmount: BigInt(rawAmount),
      decimals: context.decimals,
    });
    const signedTransaction = await runCryptoTask('offline.signTransaction', () =>
      signedTransactionFromMessage({ message, signingSeed }),
    );
    const verification = await verifyOfflineSignedTransaction({
      signedTransaction,
      network: params.network,
      expectedRecipient: context.recipientTokenAccount,
      expectedAmount: rawAmount,
      expectedAmountUnit: 'raw',
      expectedToken: context.mint,
    });

    await saveOfflineNonceState({
      walletAddress: params.walletAddress,
      network: params.network,
      nonceAccount: nonce.nonceAccount,
      nonceAuthority: nonce.nonceAuthority,
      cachedNonce: nonce.nonceValue,
    });

    return {
      signedTransaction,
      rawAmount,
      tokenMint: context.mint,
      tokenSymbol: context.symbol,
      nonceAccount: nonce.nonceAccount,
      recipientTokenAccount: context.recipientTokenAccount,
      verification,
    };
  } finally {
    zeroOutBytes(signingSeed);
  }
}

export async function buildAndEnqueueOfflineStablecoinPayment(params: {
  walletAddress: string;
  walletId?: string | null;
  network: OffpayNetwork;
  recipient: string;
  amount: string;
  token: string;
}): Promise<
  OfflineSignedTransactionVerification & {
    uploaded: boolean;
    rawAmount: string;
    tokenMint: string;
    tokenSymbol: 'USDC' | 'USDT';
    recipientTokenAccount: string;
  }
> {
  const built = await buildSignedStablecoinOfflinePayment(params);
  const queued = await enqueueOfflineSignedPayment({
    walletAddress: params.walletAddress,
    walletId: params.walletId,
    network: params.network,
    signedTransaction: built.signedTransaction,
    expectedRecipient: built.recipientTokenAccount,
    expectedAmount: built.rawAmount,
    expectedAmountUnit: 'raw',
    token: built.tokenMint,
  });
  await lockOfflinePaymentSlotForTx({
    walletAddress: params.walletAddress,
    network: params.network,
    nonceAccount: built.nonceAccount,
    txId: queued.txId,
  });

  return {
    ...queued,
    rawAmount: built.rawAmount,
    tokenMint: built.tokenMint,
    tokenSymbol: built.tokenSymbol,
    recipientTokenAccount: built.recipientTokenAccount,
  };
}

export async function buildAndEnqueueOfflineSolPayment(params: {
  walletAddress: string;
  walletId?: string | null;
  network: OffpayNetwork;
  recipient: string;
  amount: string;
  token?: string | null;
}): Promise<OfflineSignedTransactionVerification & { uploaded: boolean; rawAmount: string }> {
  const built = await buildSignedNativeSolOfflinePayment(params);
  const queued = await enqueueOfflineSignedPayment({
    walletAddress: params.walletAddress,
    walletId: params.walletId,
    network: params.network,
    signedTransaction: built.signedTransaction,
    expectedRecipient: params.recipient,
    expectedAmount: built.rawAmount,
    expectedAmountUnit: 'raw',
    token: params.token ?? 'SOL',
  });

  return {
    ...queued,
    rawAmount: built.rawAmount,
  };
}

export async function enqueueOfflineSignedPayment(params: {
  walletAddress: string;
  walletId?: string | null;
  network: OffpayNetwork;
  signedTransaction: string;
  expectedRecipient?: string | null;
  expectedAmount?: string | null;
  token?: string | null;
  expectedAmountUnit?: OfflineExpectedAmountUnit;
}): Promise<OfflineSignedTransactionVerification & { uploaded: boolean }> {
  const verification = await verifyOfflineSignedTransaction({
    signedTransaction: params.signedTransaction,
    network: params.network,
    expectedRecipient: params.expectedRecipient,
    expectedAmount: params.expectedAmount,
    expectedAmountUnit: params.expectedAmountUnit,
    expectedToken: params.token,
  });
  const previousNonceState = await lockOfflineNonceForPayment({
    walletAddress: params.walletAddress,
    network: params.network,
    verification,
  });

  let backup: Awaited<ReturnType<typeof enqueuePendingPaymentBackup>>;
  try {
    backup = await enqueuePendingPaymentBackup({
      walletAddress: params.walletAddress,
      walletId: params.walletId ?? undefined,
      network: params.network,
      txId: verification.txId,
      signedBlob: verification.signedBlob,
      kind: 'offline-payment',
      metadata: {
        recipient: params.expectedRecipient ?? null,
        amount: params.expectedAmount ?? null,
        amountUnit: params.expectedAmountUnit ?? 'raw',
        token: params.token ?? null,
        nonceAccount: verification.nonceAccount,
        nonceAuthority: verification.nonceAuthority,
      },
      uploadImmediately: false,
    });
  } catch (error) {
    await persistOfflineNonceState({
      ...previousNonceState,
      status: 'ready',
      lockedTxId: null,
      errorMessage: error instanceof Error ? error.message : 'Offline payment queueing failed.',
      updatedAt: Date.now(),
    });
    throw error;
  }

  return {
    ...verification,
    uploaded: backup.uploaded,
  };
}

export async function enqueueReceivedOfflineSignedPayment(params: {
  walletAddress: string;
  walletId?: string | null;
  network: OffpayNetwork;
  txId: string;
  signedTransaction: string;
  expectedRecipient?: string | null;
  expectedAmount?: string | null;
  token?: string | null;
  sender?: string | null;
}): Promise<OfflineSignedTransactionVerification & { uploaded: boolean }> {
  const verification = await verifyOfflineSignedTransaction({
    signedTransaction: params.signedTransaction,
    network: params.network,
    expectedRecipient: params.expectedRecipient,
    expectedAmount: params.expectedAmount,
    expectedAmountUnit: 'raw',
    expectedToken: params.token,
  });

  if (verification.txId !== params.txId) {
    throw new Error('Received offline payment id does not match the signed transaction.');
  }

  if (
    params.sender != null &&
    params.sender.trim().length > 0 &&
    !verification.requiredSigners.includes(assertBase58PublicKey(params.sender, 'Offline sender'))
  ) {
    throw new Error('Received offline payment sender does not match the transaction signer.');
  }

  const backup = await enqueuePendingPaymentBackup({
    walletAddress: params.walletAddress,
    walletId: params.walletId ?? undefined,
    network: params.network,
    txId: verification.txId,
    signedBlob: verification.signedBlob,
    kind: 'offline-payment',
    metadata: {
      direction: 'receive',
      sender: params.sender ?? null,
      recipient: params.expectedRecipient ?? null,
      amount: params.expectedAmount ?? null,
      amountUnit: 'raw',
      token: params.token ?? null,
      nonceAccount: verification.nonceAccount,
      nonceAuthority: verification.nonceAuthority,
    },
    uploadImmediately: false,
  });

  return {
    ...verification,
    uploaded: backup.uploaded,
  };
}
