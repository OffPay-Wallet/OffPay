import { AppError } from './errors.js';
import { createNetworkCacheKey, memoryCache } from './cache.js';
import { writeOperationalLog } from './logging.js';
import { getOrSetSharedJsonCache } from './shared-cache.js';
import {
  getHeliusRpcHttpUrlCandidate,
  getRpcHttpUrlCandidates,
  type RpcProviderEndpoint,
} from './solana-rpc-providers.js';
import type { Bindings, Network } from './types.js';
import { isRecord, isValidSolanaAddress } from './validation.js';

const MAINNET_WALLET_API_BASE_URL = 'https://api.helius.xyz';
const MAINNET_ENHANCED_TRANSACTIONS_API_BASE_URL = 'https://mainnet.helius-rpc.com';
const DEVNET_ENHANCED_TRANSACTIONS_API_BASE_URL = 'https://devnet.helius-rpc.com';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const HELIUS_NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111111';
const SOL_DECIMALS = 9;
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
const MEMO_PROGRAM_IDS = new Set([
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
]);
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const UMBRA_PROGRAM_IDS: Readonly<Record<Network, string>> = {
  mainnet: 'UMBRAD2ishebJTcgCLkTkNUx1v3GyoAgpTRPeWoLykh',
  devnet: 'DSuKkyqGVGgo4QtPABfxKJKygUDACbUhirnuv63mEpAJ',
};
const KNOWN_PROGRAM_IDS = new Set([
  SYSTEM_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
]);
const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MAINNET_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const WALLET_BALANCE_CACHE_TTL_MS = 30_000;
const WALLET_TRANSACTIONS_CACHE_TTL_MS = 60_000;
const STREAM_CAPABILITY_CACHE_TTL_MS = 60_000;
const TOKEN_METADATA_CACHE_TTL_MS = 60 * 60_000;
const DEFAULT_TRANSACTION_LIMIT = 25;
const WALLET_TRANSACTION_SIGNATURE_PAGE_SIZE = 100;
const WALLET_NATIVE_SOL_SUPPLEMENT_MIN_LIMIT = 50;
const WALLET_NATIVE_SOL_SUPPLEMENT_LIMIT = 50;
const MAX_WALLET_TRANSACTION_SIGNATURE_SCAN = 1_000;
const MIN_WALLET_TRANSACTION_BATCH_SIZE = 20;
const TOKEN_TRANSACTION_SIGNATURE_PAGE_SIZE = 100;
// Bounded first-page scan. Native SOL touches far more signatures (rent, fees,
// internal movements) than displayable rows, so the old unbounded 1000-sig
// scan was the ~12s token-history tail. Older rows load on demand via the
// response cursor, so this only bounds the FIRST page.
const MAX_NATIVE_SOL_TOKEN_TRANSACTION_SIGNATURE_SCAN = 200;
const MAX_SPL_TOKEN_TRANSACTION_SIGNATURE_SCAN = 200;
// Hard wall-clock ceiling for a single first-page scan loop. On hit we stop and
// return the cursor reached so far (so the client knows more is available),
// keeping endpoints < 3s even when most scanned signatures are non-displayable.
// Tune against the Phase 0 tx_signatures / tx_batch / tx_pages numbers.
const WALLET_TRANSACTION_SCAN_BUDGET_MS = 2_500;
// Helius getTransactionsForAddress returns full, newest-first transactions in a
// single indexed JSON-RPC call (no per-signature getTransaction fan-out) and
// supports up to 1000 per page. We page backwards with `paginationToken`,
// collecting displayable (or mint-matching) rows until the requested count is
// reached or a budget is hit; the response cursor lets the client continue.
const INDEXED_TRANSACTION_PAGE_SIZE = 100;
// First-page scan ceiling for token-specific history. Native SOL has no
// server-side mint filter (it is not a token transfer), so matching rows can be
// sparse and we allow a few indexed pages; older rows load on demand via the
// cursor. SPL mints are filtered server-side and fill far sooner.
const MAX_INDEXED_TOKEN_TRANSACTION_SCAN = 500;
const DEFAULT_STREAM_POLL_INTERVAL_MS = 10_000;
const DEFAULT_STREAM_WEBSOCKET_FALLBACK_POLL_INTERVAL_MS = 45_000;
const DEFAULT_STREAM_ACTIVITY_LIMIT = 10;

interface WalletBalanceToken {
  mint: string;
  name: string;
  symbol: string;
  logo: string | null;
  balance: string;
  decimals: number;
  verified: boolean;
  spam: boolean;
}

interface WalletBalanceResponse {
  address: string;
  network: Network;
  solBalance: number;
  tokens: WalletBalanceToken[];
  fetchedAt: number;
}

interface WalletTransactionCounterparty {
  address: string;
  role: string;
}

type WalletTransactionDisplayType = 'send' | 'receive' | 'swap';
type WalletTransactionDisplayTone = 'positive' | 'negative' | 'neutral' | 'failed';

interface WalletTransactionView {
  id: string;
  type: WalletTransactionDisplayType;
  title: string;
  subtitle: string;
  sourceLabel: string | null;
  amountLabel: string | null;
  secondaryAmountLabel: string | null;
  amountTone: WalletTransactionDisplayTone;
  tokenMint: string | null;
  tokenSymbol: string | null;
  tokenName: string | null;
  tokenLogo: string | null;
  status: 'confirmed' | 'pending' | 'failed';
  detailTimestampMs: number | null;
  detailNetwork: Network | null;
  detailSignature: string | null;
  detailAccountLabel: string | null;
  detailAccountAddress: string | null;
}

interface WalletTransactionGroup {
  title: string;
  data: WalletTransactionView[];
}

interface WalletTransactionRecord {
  signature: string;
  timestamp: number;
  type: string;
  description: string | null;
  amount?: string | null;
  rawAmount?: string | null;
  tokenMint?: string | null;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  tokenLogo?: string | null;
  tokenDecimals?: number | null;
  fee: number;
  status: 'success' | 'failed';
  direction?: 'send' | 'receive' | null;
  sender?: string | null;
  recipient?: string | null;
  counterparties: WalletTransactionCounterparty[];
  display?: WalletTransactionView | null;
}

interface RpcSignatureEntry {
  signature: string;
  timestamp: number;
  status: 'success' | 'failed';
}

interface RpcSignaturePage {
  entries: RpcSignatureEntry[];
  hasMore: boolean;
  tokenAccounts: WalletTokenAccountAddress[];
}

interface WalletTransactionsResponse {
  address: string;
  network: Network;
  transactions: WalletTransactionRecord[];
  displayTransactions: WalletTransactionView[];
  historyGroups: WalletTransactionGroup[];
  cursor: string | null;
  fetchedAt: number;
}

interface WalletTokenAccountAddress {
  address: string;
  mint: string;
  programId: string;
}

interface StreamCapabilities {
  walletActivity: boolean;
}

interface StreamCapabilitiesResponse {
  network: Network;
  capabilities: StreamCapabilities;
}

interface LatestBlockhashResponse {
  blockhash: string;
  lastValidBlockHeight: number;
}

interface RpcAccountInfo {
  address: string;
  pubkey: string;
  exists: boolean;
  executable: boolean | null;
  lamports: string | null;
  owner: string | null;
  rentEpoch: number | null;
  dataBase64: string | null;
  data: string | null;
  space: number | null;
}

interface RpcAccountsRequest {
  addresses: string[];
  network: Network;
}

interface RpcAccountsResponse {
  network: Network;
  accounts: RpcAccountInfo[];
  fetchedAt: number;
}

interface RpcTokenLargestAccount {
  address: string;
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString: string | null;
}

interface RpcTokenLargestAccountsRequest {
  mint: string;
  network: Network;
}

interface RpcTokenLargestAccountsResponse {
  network: Network;
  mint: string;
  accounts: RpcTokenLargestAccount[];
  fetchedAt: number;
}

interface RpcEpochInfoResponse {
  network: Network;
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
  absoluteSlot: number;
  blockHeight: number | null;
  transactionCount: number | null;
  fetchedAt: number;
}

interface RpcSlotResponse {
  network: Network;
  slot: number;
  fetchedAt: number;
}

interface RpcSignatureStatusRecord {
  signature: string;
  found: boolean;
  slot: number | null;
  confirmations: number | null;
  confirmationStatus: string | null;
  err: unknown | null;
}

interface RpcSignatureStatusesRequest {
  signatures: string[];
  network: Network;
}

interface RpcSignatureStatusesResponse {
  network: Network;
  statuses: RpcSignatureStatusRecord[];
  fetchedAt: number;
}

interface RpcSignaturesForAddressRequest {
  address: string;
  network: Network;
  limit?: number;
  before?: string | null;
}

interface RpcSignatureForAddressRecord {
  signature: string;
  slot: number;
  err: unknown | null;
  memo: string | null;
  blockTime: number | null;
  confirmationStatus: string | null;
}

interface RpcSignaturesForAddressResponse {
  network: Network;
  address: string;
  signatures: RpcSignatureForAddressRecord[];
  fetchedAt: number;
}

interface MinimumRentExemptionRequest {
  network: Network;
  space: number;
}

interface FeeForMessageRequest {
  messageBase64: string;
  network: Network;
}

interface WalletLamportsRequest {
  address: string;
  network: Network;
}

export type TimingRecorder = (name: string, durationMs: number) => void;

/**
 * Phase 0 instrumentation: per-request accumulator for the RPC scan sub-steps
 * so wallet-path latency can be attributed (token-account discovery vs.
 * signature fetch vs. transaction-batch enrichment vs. page count) instead of
 * guessed at. Flushed once per scan via a TimingRecorder.
 */
interface WalletScanTimings {
  tokenAccountsMs: number;
  signaturesMs: number;
  txBatchMs: number;
  pages: number;
}

interface WalletBalanceRequest {
  address: string;
  network: Network;
  useCache?: boolean;
  recordTiming?: TimingRecorder;
}

interface WalletTransactionsRequest {
  address: string;
  network: Network;
  cursor?: string | null;
  limit?: number;
  useCache?: boolean;
  recordTiming?: TimingRecorder;
}

interface WalletTokenTransactionsRequest extends WalletTransactionsRequest {
  mint: string;
}

interface RawTransactionBroadcastRequest {
  rawTransaction: string;
  network: Network;
}

interface RawTransactionBroadcastResponse {
  signature: string;
}

interface WalletMintRawBalanceRequest {
  address: string;
  mint: string;
  network: Network;
}

interface WalletMintAccountExistsRequest {
  address: string;
  mint: string;
  network: Network;
}

interface TransactionExecutionStatusRequest {
  signature: string;
  network: Network;
  attempts?: number;
  delayMs?: number;
}

interface TransactionExecutionStatusResponse {
  success: boolean | null;
  error: string | null;
}

type HeliusFetchImplementation = (input: string, init: RequestInit) => Promise<Response>;

type RpcRequestParams = readonly unknown[] | Readonly<Record<string, unknown>>;

interface RpcBatchRequest {
  id: string;
  method: string;
  params: RpcRequestParams;
}

interface BalanceAccumulator {
  readonly mint: string;
  readonly decimals: number;
  rawAmount: bigint;
}

interface TokenMetadata {
  name: string | null;
  symbol: string | null;
  logo: string | null;
  decimals: number | null;
  verified: boolean;
  spam: boolean;
}

interface TokenBalanceDelta {
  mint: string;
  decimals: number;
  rawDelta: bigint;
}

interface OwnerTokenBalanceDelta extends TokenBalanceDelta {
  owner: string;
}

interface TransactionTokenFields {
  amount: string | null;
  rawAmount: string | null;
  tokenMint: string | null;
  tokenSymbol: string | null;
  tokenName: string | null;
  tokenLogo: string | null;
  tokenDecimals: number | null;
  direction: 'send' | 'receive' | null;
}

const NATIVE_SOL_METADATA: TokenMetadata = {
  name: 'Solana',
  symbol: 'SOL',
  logo: null,
  decimals: SOL_DECIMALS,
  verified: true,
  spam: false,
};

const CANONICAL_STABLECOIN_METADATA: Record<
  Network,
  Record<
    string,
    {
      name: string;
      symbol: string;
      decimals: number;
    }
  >
> = {
  mainnet: {
    [MAINNET_USDC_MINT]: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
    [MAINNET_USDT_MINT]: { name: 'Tether USD', symbol: 'USDT', decimals: 6 },
  },
  devnet: {
    [DEVNET_USDC_MINT]: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  },
};

const STREAM_DEFAULTS: Record<Network, StreamCapabilities> = {
  devnet: {
    walletActivity: true,
  },
  mainnet: {
    walletActivity: true,
  },
};

let heliusFetchImplementation: HeliusFetchImplementation = (input, init) => fetch(input, init);

function getRequiredBinding(bindings: Bindings, key: keyof Bindings): string {
  const rawValue = bindings[key];
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Required backend configuration is unavailable.',
      retryable: true,
    });
  }

  return value;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function readNonNegativeBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value >= 0n ? value : null;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return BigInt(Math.trunc(value));
  }

  const trimmed = readTrimmedString(value);
  if (trimmed != null && /^\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }

  return null;
}

function readBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }

  const trimmed = readTrimmedString(value);
  if (trimmed != null && /^-?\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }

  return null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function isWalletBalanceResponse(value: unknown): value is WalletBalanceResponse {
  return (
    isRecord(value) &&
    isValidSolanaAddress(readTrimmedString(value.address) ?? '') &&
    (value.network === 'devnet' || value.network === 'mainnet') &&
    typeof value.solBalance === 'number' &&
    Number.isFinite(value.solBalance) &&
    Array.isArray(value.tokens) &&
    typeof value.fetchedAt === 'number' &&
    Number.isFinite(value.fetchedAt)
  );
}

function isWalletTransactionsResponse(value: unknown): value is WalletTransactionsResponse {
  return (
    isRecord(value) &&
    isValidSolanaAddress(readTrimmedString(value.address) ?? '') &&
    (value.network === 'devnet' || value.network === 'mainnet') &&
    Array.isArray(value.transactions) &&
    Array.isArray(value.displayTransactions) &&
    Array.isArray(value.historyGroups) &&
    (value.cursor === null || typeof value.cursor === 'string') &&
    typeof value.fetchedAt === 'number' &&
    Number.isFinite(value.fetchedAt)
  );
}

function shortenAddress(address: string): string {
  return address.length <= 10 ? address : `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function sanitizeText(value: string | null | undefined, maxLength = 160): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function sanitizeTokenLabel(
  value: string | null | undefined,
  fallback: string,
  maxLength: number,
): string {
  const sanitized = sanitizeText(value, maxLength);
  return sanitized ?? fallback;
}

function sanitizeProviderTransactionType(value: string | null | undefined): string {
  const sanitized = sanitizeText(value, 64)
    ?.toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized && sanitized.length > 0 ? sanitized : 'UNKNOWN';
}

function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLikelySpamToken(name: string, symbol: string): boolean {
  const combined = `${name} ${symbol}`.toLowerCase();
  const suspiciousPattern =
    /(claim|airdrop|visit|free|bonus|reward|gift|promo|discord|telegram|t\.me|http|www\.|\.com|\.io)/i;

  if (suspiciousPattern.test(combined)) {
    return true;
  }

  if (name.length > 80 || symbol.length > 24) {
    return true;
  }

  return false;
}

function isHeliusNativeSolEntry(entry: {
  mint: string;
  name: string | null;
  symbol: string | null;
  decimals: number;
}): boolean {
  if (entry.mint === SOL_MINT || entry.mint === HELIUS_NATIVE_SOL_MINT) {
    return true;
  }

  return entry.decimals === 9 && entry.symbol === 'SOL' && entry.name === 'Solana';
}

function isNativeSolMint(mint: string | null | undefined): boolean {
  return mint === SOL_MINT || mint === HELIUS_NATIVE_SOL_MINT;
}

function numberToDecimalString(value: number): string {
  if (Number.isInteger(value)) {
    return value.toString();
  }

  return value
    .toLocaleString('en-US', {
      useGrouping: false,
      maximumFractionDigits: 20,
    })
    .replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
}

function decimalStringToScaledInteger(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return 0n;
  }

  const [wholePart, fractionalPart = ''] = trimmed.split('.');
  const normalizedFractional = fractionalPart.slice(0, decimals).padEnd(decimals, '0');
  return BigInt(`${wholePart}${normalizedFractional}`);
}

function uiAmountToRawInteger(value: number, decimals: number): bigint {
  return decimalStringToScaledInteger(numberToDecimalString(value), decimals);
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function bigintToSafeInteger(value: bigint): number {
  const maxSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > maxSafeInteger) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Number(value);
}

function formatTokenAmount(rawAmount: bigint, decimals: number): string {
  if (decimals <= 0) {
    return rawAmount.toString();
  }

  const negative = rawAmount < 0n;
  const absolute = negative ? -rawAmount : rawAmount;
  const digits = absolute.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, -decimals) || '0';
  const fractional = digits.slice(-decimals).replace(/0+$/, '');
  const value = fractional.length > 0 ? `${whole}.${fractional}` : whole;
  return negative ? `-${value}` : value;
}

function normalizeCounterpartyRole(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 32) || 'participant'
  );
}

function appendCounterparty(
  counterparties: WalletTransactionCounterparty[],
  address: string | null | undefined,
  role: string,
  walletAddress: string,
): void {
  if (!address || !isValidSolanaAddress(address) || address === walletAddress) {
    return;
  }

  if (counterparties.some((entry) => entry.address === address && entry.role === role)) {
    return;
  }

  counterparties.push({
    address,
    role: normalizeCounterpartyRole(role),
  });
}

function containsStringValue(value: unknown, target: string, depth = 0): boolean {
  if (depth > 8) {
    return false;
  }

  if (typeof value === 'string') {
    return value === target;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsStringValue(entry, target, depth + 1));
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).some((entry) => containsStringValue(entry, target, depth + 1));
}

function collectSolanaAddresses(value: unknown, addresses: Set<string>, depth = 0): void {
  if (depth > 6) {
    return;
  }

  if (typeof value === 'string') {
    if (isValidSolanaAddress(value)) {
      addresses.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSolanaAddresses(entry, addresses, depth + 1);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const nestedValue of Object.values(value)) {
    collectSolanaAddresses(nestedValue, addresses, depth + 1);
  }
}

function collectUmbraInstructionAccounts(
  value: unknown,
  programId: string,
  addresses: Set<string>,
  depth = 0,
): void {
  if (depth > 8) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectUmbraInstructionAccounts(entry, programId, addresses, depth + 1);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const instructionProgramId = readTrimmedString(value.programId);
  const instructionTouchesUmbra =
    instructionProgramId === programId ||
    (Array.isArray(value.accounts) && containsStringValue(value.accounts, programId));
  if (instructionTouchesUmbra && Array.isArray(value.accounts)) {
    collectSolanaAddresses(value.accounts, addresses, depth + 1);
  }

  for (const nestedValue of Object.values(value)) {
    collectUmbraInstructionAccounts(nestedValue, programId, addresses, depth + 1);
  }
}

function transactionTouchesUmbraProgram(value: unknown, network: Network): boolean {
  return containsStringValue(value, UMBRA_PROGRAM_IDS[network]);
}

function extractUmbraPoolCounterparties(
  value: unknown,
  network: Network,
  walletAddress: string,
): WalletTransactionCounterparty[] {
  const programId = UMBRA_PROGRAM_IDS[network];
  const addresses = new Set<string>();
  collectUmbraInstructionAccounts(value, programId, addresses);

  const counterparties: WalletTransactionCounterparty[] = [];
  for (const address of addresses) {
    if (address === programId || address === walletAddress || KNOWN_PROGRAM_IDS.has(address)) {
      continue;
    }

    appendCounterparty(counterparties, address, 'umbra_pool', walletAddress);
    if (counterparties.length >= 3) {
      break;
    }
  }

  if (counterparties.length === 0) {
    appendCounterparty(counterparties, programId, 'umbra_program', walletAddress);
  }

  return counterparties;
}

function classifyUmbraTransaction(
  direction: 'send' | 'receive' | null,
  providerType: string | null,
  description: string | null,
  instructionNames: readonly string[] = [],
): { type: string; description: string } {
  const normalizedInstructionNames = instructionNames.map((name) => name.toLowerCase());
  if (
    normalizedInstructionNames.some(
      (name) => name.includes('claiminto') && !name.includes('callback'),
    )
  ) {
    return {
      type: 'umbra_claim',
      description: 'Umbra private payment claimed',
    };
  }
  if (normalizedInstructionNames.some((name) => name.includes('withdrawfrom'))) {
    return {
      type: 'umbra_withdraw',
      description: 'Umbra private balance withdrawn',
    };
  }

  const combined = `${providerType ?? ''} ${description ?? ''}`.toLowerCase();
  if (combined.includes('withdraw')) {
    return {
      type: 'umbra_withdraw',
      description: 'Umbra private balance withdrawn',
    };
  }

  if (
    normalizedInstructionNames.some(
      (name) =>
        name.includes('register') || name.includes('registration') || name.includes('setup'),
    ) ||
    combined.includes('registration') ||
    combined.includes('setup')
  ) {
    return {
      type: 'umbra_setup',
      description: 'Umbra private account setup',
    };
  }

  if (direction === 'send') {
    return {
      type: 'umbra_private_send',
      description: 'Umbra private payment sent',
    };
  }

  if (direction === 'receive') {
    return {
      type: 'umbra_claim',
      description: 'Umbra private payment claimed',
    };
  }

  return {
    type: 'umbra_setup',
    description: 'Umbra private account setup',
  };
}

function extractUmbraInstructionNames(value: unknown): string[] {
  const names = new Set<string>();

  function collect(candidate: unknown): void {
    if (typeof candidate === 'string') {
      const match = candidate.match(/Instruction:\s*([A-Za-z0-9_]+)/);
      if (match?.[1]) names.add(match[1]);
      return;
    }

    if (Array.isArray(candidate)) {
      candidate.forEach(collect);
      return;
    }

    if (!isRecord(candidate)) return;

    const parsed = isRecord(candidate.parsed) ? candidate.parsed : null;
    const parsedType = parsed ? readTrimmedString(parsed.type) : null;
    if (parsedType) names.add(parsedType);

    for (const nestedValue of Object.values(candidate)) {
      collect(nestedValue);
    }
  }

  collect(value);
  return [...names];
}

function getHeliusApiKey(bindings: Bindings, network: Network): string {
  return network === 'devnet'
    ? getRequiredBinding(bindings, 'HELIUS_DEVNET_API_KEY')
    : getRequiredBinding(bindings, 'HELIUS_MAINNET_API_KEY');
}

// Whether the Helius API key needed for the indexed Enhanced Transactions API
// is configured for this network. When absent (e.g. RPC-only deployments) we
// skip the indexed path and use the raw RPC signature scan instead.
function hasHeliusApiKey(bindings: Bindings, network: Network): boolean {
  const apiKey =
    network === 'devnet' ? bindings.HELIUS_DEVNET_API_KEY : bindings.HELIUS_MAINNET_API_KEY;
  return typeof apiKey === 'string' && apiKey.trim().length > 0;
}

function getEnhancedTransactionsApiBaseUrl(network: Network): string {
  return network === 'devnet'
    ? DEVNET_ENHANCED_TRANSACTIONS_API_BASE_URL
    : MAINNET_ENHANCED_TRANSACTIONS_API_BASE_URL;
}

function toUpstreamUnavailable(
  response: Response | null,
  message: string,
  cause?: unknown,
): AppError {
  const retryAfterHeader = response?.headers.get('retry-after')?.trim();
  const retryAfterMs =
    retryAfterHeader && /^\d+$/.test(retryAfterHeader)
      ? Number(retryAfterHeader) * 1000
      : undefined;

  return new AppError({
    status: 503,
    code: 'UPSTREAM_UNAVAILABLE',
    message,
    retryable: true,
    ...(retryAfterMs && retryAfterMs > 0 ? { retryAfterMs } : {}),
    ...(cause === undefined ? {} : { cause }),
  });
}

function describeIndexedFallbackCause(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (isRecord(cause)) {
      return {
        status: error.status,
        code: error.code,
        httpStatus: readFiniteNumber(cause.httpStatus),
        statusText: readTrimmedString(cause.statusText),
        causeCode: readFiniteNumber(cause.code),
        causeMessage: readTrimmedString(cause.message),
        upstreamText: readTrimmedString(cause.upstreamText),
      };
    }
    if (cause instanceof Error) {
      return {
        status: error.status,
        code: error.code,
        causeName: cause.name,
        causeMessage: cause.message,
      };
    }

    return {
      status: error.status,
      code: error.code,
    };
  }

  if (error instanceof Error) {
    return {
      causeName: error.name,
      causeMessage: error.message,
    };
  }

  return { causeType: typeof error };
}

function isRetryableRpcError(errorValue: Record<string, unknown>): boolean {
  const code = readFiniteNumber(errorValue.code);
  if (code === 429) return true;

  const message = readTrimmedString(errorValue.message)?.toLowerCase() ?? '';
  return (
    /rate[-\s]?limit/.test(message) ||
    message.includes('too many requests') ||
    message.includes('request limit') ||
    message.includes('limit exceeded') ||
    message.includes('quota') ||
    message.includes('temporarily unavailable') ||
    message.includes('service unavailable') ||
    message.includes('gateway timeout') ||
    message.includes('timeout') ||
    message.includes('timed out')
  );
}

// Per-attempt ceiling for a single upstream Solana RPC call. 3s proved too
// tight: devnet getTransaction batches legitimately spike past it, and with a
// single configured provider (no Alchemy hedge) that aborted call becomes a
// hard 503 (the token-history failures). 6s absorbs that variance while still
// capping a truly hung provider. Once a 2nd provider is configured, Phase 5
// hedging races the slow one so this can be tightened again.
const RPC_HTTP_TIMEOUT_MS = 6000;

async function fetchJson(
  url: string,
  init: RequestInit,
  errorMessage: string,
  externalSignal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`RPC request timed out after ${RPC_HTTP_TIMEOUT_MS}ms`));
  }, RPC_HTTP_TIMEOUT_MS);

  // Allow an outer caller (the hedge orchestrator) to abort this attempt when a
  // competing provider wins, so a losing request doesn't keep consuming quota.
  const onExternalAbort = (): void => controller.abort(externalSignal?.reason);
  if (externalSignal != null) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    let response: Response;
    try {
      response = await heliusFetchImplementation(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw toUpstreamUnavailable(null, errorMessage, error);
    }

    if (!response.ok) {
      let upstreamText: string | null = null;
      try {
        upstreamText = sanitizeText(await response.text(), 240);
      } catch {
        upstreamText = null;
      }
      throw toUpstreamUnavailable(response, errorMessage, {
        httpStatus: response.status,
        statusText: response.statusText,
        upstreamText,
      });
    }

    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw toUpstreamUnavailable(response, errorMessage, error);
    }
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal != null) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

// Staggered hedged RPC across the configured providers. With a single provider
// this is identical to one plain attempt (no concurrency, no extra load). With
// >=2 providers we start the primary and, if it hasn't answered within
// RPC_HEDGE_DELAY_MS, start the next provider concurrently and take whichever
// responds first, aborting the losers. A provider error advances to the next
// candidate immediately. This removes the additive cost of serial fallthrough
// on a slow-but-not-failed provider without doubling load on the fast path.
// NOTE: this only wraps standard JSON-RPC calls; Helius-only enhanced API
// endpoints don't go through getRpcHttpUrlCandidates, so they're never hedged.
const RPC_HEDGE_DELAY_MS = 600;

async function requestWithHedge<T>(
  candidates: readonly RpcProviderEndpoint[],
  attempt: (candidate: RpcProviderEndpoint, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (candidates.length === 0) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  return new Promise<T>((resolve, reject) => {
    let nextIndex = 0;
    let pending = 0;
    let settled = false;
    let lastError: unknown = null;
    const controllers: AbortController[] = [];
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null;

    const clearHedgeTimer = (): void => {
      if (hedgeTimer != null) {
        clearTimeout(hedgeTimer);
        hedgeTimer = null;
      }
    };

    const scheduleHedge = (): void => {
      clearHedgeTimer();
      if (nextIndex >= candidates.length) return;
      hedgeTimer = setTimeout(() => {
        hedgeTimer = null;
        launchNext();
      }, RPC_HEDGE_DELAY_MS);
    };

    const launchNext = (): void => {
      if (settled || nextIndex >= candidates.length) return;
      const candidate = candidates[nextIndex];
      nextIndex += 1;
      const controller = new AbortController();
      controllers.push(controller);
      pending += 1;
      // Start the next provider after the hedge delay even if this one is still
      // in flight (cancelled if this one settles first).
      scheduleHedge();

      attempt(candidate, controller.signal).then(
        (value) => {
          if (settled) return;
          settled = true;
          clearHedgeTimer();
          for (const other of controllers) {
            if (other !== controller) other.abort();
          }
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          lastError = error;
          pending -= 1;
          // A failed provider advances immediately, without waiting for the
          // hedge delay.
          if (nextIndex < candidates.length) {
            launchNext();
          } else if (pending === 0) {
            settled = true;
            clearHedgeTimer();
            reject(
              toUpstreamUnavailable(
                null,
                'Wallet provider is temporarily unavailable.',
                lastError ?? undefined,
              ),
            );
          }
        },
      );
    };

    launchNext();
  });
}

async function heliusRpcRequest(
  bindings: Bindings,
  network: Network,
  method: string,
  params: RpcRequestParams,
): Promise<unknown> {
  const candidates = getRpcHttpUrlCandidates(bindings, network);

  return requestWithHedge(candidates, async (candidate, signal) => {
    const payload = await fetchJson(
      candidate.url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `${method}:${network}:${candidate.provider}`,
          method,
          params,
        }),
      },
      'Wallet provider is temporarily unavailable.',
      signal,
    );

    if (!isRecord(payload)) {
      throw new Error('RPC provider returned a malformed payload.');
    }

    if ('error' in payload && payload.error !== null && payload.error !== undefined) {
      throw new Error('RPC provider returned an error.', { cause: payload.error });
    }

    return payload.result;
  });
}

async function heliusExclusiveRpcRequest(
  bindings: Bindings,
  network: Network,
  method: string,
  params: RpcRequestParams,
): Promise<unknown> {
  const candidate = getHeliusRpcHttpUrlCandidate(bindings, network);
  if (candidate == null) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  const payload = await fetchJson(
    candidate.url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `${method}:${network}:helius`,
        method,
        params,
      }),
    },
    'Wallet provider is temporarily unavailable.',
  );

  if (!isRecord(payload)) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  if ('error' in payload && payload.error !== null && payload.error !== undefined) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.', payload.error);
  }

  return payload.result;
}

async function heliusRpcBatchRequest(
  bindings: Bindings,
  network: Network,
  requests: readonly RpcBatchRequest[],
): Promise<unknown[]> {
  if (requests.length === 0) {
    return [];
  }

  const candidates = getRpcHttpUrlCandidates(bindings, network);

  return requestWithHedge(candidates, async (candidate, signal) => {
    const payload = await fetchJson(
      candidate.url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          requests.map((request) => ({
            jsonrpc: '2.0',
            id: `${request.id}:${network}:${candidate.provider}`,
            method: request.method,
            params: request.params,
          })),
        ),
      },
      'Wallet provider is temporarily unavailable.',
      signal,
    );

    if (!Array.isArray(payload)) {
      throw new Error('RPC provider returned a malformed batch payload.');
    }

    const resultsById = new Map<string, unknown>();

    for (const entry of payload) {
      if (!isRecord(entry)) {
        throw new Error('RPC provider returned a malformed batch entry.');
      }

      const responseId = readTrimmedString(entry.id);
      if (!responseId) {
        throw new Error('RPC provider returned a batch entry without an id.');
      }

      if ('error' in entry && entry.error !== null && entry.error !== undefined) {
        throw new Error('RPC provider returned a batch error.', { cause: entry.error });
      }

      resultsById.set(responseId, entry.result ?? null);
    }

    const orderedResults: unknown[] = [];
    for (const request of requests) {
      const responseId = `${request.id}:${network}:${candidate.provider}`;
      if (!resultsById.has(responseId)) {
        throw new Error('RPC provider omitted a batch result.');
      }
      orderedResults.push(resultsById.get(responseId));
    }

    return orderedResults;
  });
}

async function getLatestBlockhash(
  bindings: Bindings,
  network: Network,
): Promise<LatestBlockhashResponse> {
  const result = await heliusRpcRequest(bindings, network, 'getLatestBlockhash', [
    { commitment: 'confirmed' },
  ]);

  const value = isRecord(result) && isRecord(result.value) ? result.value : result;
  if (!isRecord(value)) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  const blockhash = readTrimmedString(value.blockhash);
  const lastValidBlockHeight = readFiniteNumber(value.lastValidBlockHeight);
  if (!blockhash || lastValidBlockHeight === null) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  return {
    blockhash,
    lastValidBlockHeight: Math.trunc(lastValidBlockHeight),
  };
}

function readAccountDataBase64(value: unknown): string | null {
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].trim() || null;
  }

  if (typeof value === 'string') {
    return value.trim() || null;
  }

  return null;
}

function parseRpcAccount(address: string, value: unknown): RpcAccountInfo {
  if (!isRecord(value)) {
    return {
      address,
      pubkey: address,
      exists: false,
      executable: null,
      lamports: null,
      owner: null,
      rentEpoch: null,
      dataBase64: null,
      data: null,
      space: null,
    };
  }

  const lamports = readFiniteNumber(value.lamports);
  const rentEpoch = readFiniteNumber(value.rentEpoch);
  const space = readFiniteNumber(value.space);
  const dataBase64 = readAccountDataBase64(value.data);

  return {
    address,
    pubkey: address,
    exists: true,
    executable: readBoolean(value.executable),
    lamports: lamports === null || lamports < 0 ? null : Math.trunc(lamports).toString(),
    owner: readTrimmedString(value.owner),
    rentEpoch: rentEpoch === null || rentEpoch < 0 ? null : Math.trunc(rentEpoch),
    dataBase64,
    data: dataBase64,
    space: space === null || space < 0 ? null : Math.trunc(space),
  };
}

async function getRpcAccounts(
  bindings: Bindings,
  request: RpcAccountsRequest,
): Promise<RpcAccountsResponse> {
  // Short-TTL per-address cache. The same handful of vault / fee /
  // encrypted-balance accounts are re-fetched many times during a single
  // send flow and across closely-spaced screen transitions (home → send,
  // send → back → send). Helius' confirmed commitment refreshes every
  // ~1-2s, and 5s is well below the ~12-30s it takes for a freshly
  // created account to finalize after tx submission — so a 5s cache
  // cannot mask an account the SDK is actively waiting to appear.
  const RPC_ACCOUNTS_CACHE_TTL_MS = 5_000;
  const now = Date.now();
  const accounts = new Array<RpcAccountInfo>(request.addresses.length);
  const uncachedAddresses: string[] = [];
  const uncachedIndices: number[] = [];

  request.addresses.forEach((address, index) => {
    const cacheKey = createNetworkCacheKey(request.network, 'rpc-accounts', [address]);
    const cached = memoryCache.get<RpcAccountInfo>(cacheKey);
    if (cached != null) {
      accounts[index] = cached;
      return;
    }
    uncachedAddresses.push(address);
    uncachedIndices.push(index);
  });

  if (uncachedAddresses.length > 0) {
    const result = await heliusRpcRequest(bindings, request.network, 'getMultipleAccounts', [
      uncachedAddresses,
      {
        commitment: 'confirmed',
        encoding: 'base64',
      },
    ]);

    const values = isRecord(result) && Array.isArray(result.value) ? result.value : null;
    if (!values) {
      throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
    }

    uncachedAddresses.forEach((address, sliceIndex) => {
      const parsed = parseRpcAccount(address, values[sliceIndex]);
      accounts[uncachedIndices[sliceIndex]] = parsed;
      memoryCache.set(
        createNetworkCacheKey(request.network, 'rpc-accounts', [address]),
        parsed,
        RPC_ACCOUNTS_CACHE_TTL_MS,
      );
    });
  }

  return {
    network: request.network,
    accounts,
    fetchedAt: now,
  };
}

function parseTokenLargestAccount(value: unknown): RpcTokenLargestAccount | null {
  if (!isRecord(value)) return null;

  const address = readString(value.address);
  const amount = readString(value.amount);
  const decimals = readFiniteNumber(value.decimals);
  if (
    address === null ||
    amount === null ||
    decimals === null ||
    decimals < 0 ||
    !isValidSolanaAddress(address)
  ) {
    return null;
  }

  return {
    address,
    amount,
    decimals: Math.trunc(decimals),
    uiAmount: readFiniteNumber(value.uiAmount),
    uiAmountString: readString(value.uiAmountString),
  };
}

async function getRpcTokenLargestAccounts(
  bindings: Bindings,
  request: RpcTokenLargestAccountsRequest,
): Promise<RpcTokenLargestAccountsResponse> {
  const result = await heliusRpcRequest(bindings, request.network, 'getTokenLargestAccounts', [
    request.mint,
    { commitment: 'confirmed' },
  ]);

  const values = isRecord(result) && Array.isArray(result.value) ? result.value : null;
  if (!values) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  return {
    network: request.network,
    mint: request.mint,
    accounts: values.flatMap((value) => {
      const account = parseTokenLargestAccount(value);
      return account === null ? [] : [account];
    }),
    fetchedAt: Date.now(),
  };
}

async function getMinimumBalanceForRentExemption(
  bindings: Bindings,
  request: MinimumRentExemptionRequest,
): Promise<string> {
  const result = await heliusRpcRequest(
    bindings,
    request.network,
    'getMinimumBalanceForRentExemption',
    [request.space, { commitment: 'confirmed' }],
  );
  const lamports = readFiniteNumber(result);
  if (lamports === null || lamports < 0) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  return Math.trunc(lamports).toString();
}

async function getFeeForMessage(
  bindings: Bindings,
  request: FeeForMessageRequest,
): Promise<string> {
  const result = await heliusRpcRequest(bindings, request.network, 'getFeeForMessage', [
    request.messageBase64,
    { commitment: 'confirmed' },
  ]);
  const lamports = isRecord(result) ? readFiniteNumber(result.value) : readFiniteNumber(result);
  if (lamports === null || lamports < 0) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  return Math.trunc(lamports).toString();
}

async function getWalletLamports(
  bindings: Bindings,
  request: WalletLamportsRequest,
): Promise<string> {
  const result = await heliusRpcRequest(bindings, request.network, 'getBalance', [
    request.address,
    { commitment: 'confirmed' },
  ]);
  const value = isRecord(result) ? readFiniteNumber(result.value) : readFiniteNumber(result);
  if (value === null || value < 0) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  return Math.trunc(value).toString();
}

async function getRpcEpochInfo(
  bindings: Bindings,
  network: Network,
): Promise<RpcEpochInfoResponse> {
  const result = await heliusRpcRequest(bindings, network, 'getEpochInfo', [
    { commitment: 'confirmed' },
  ]);
  if (!isRecord(result)) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  const epoch = readFiniteNumber(result.epoch);
  const slotIndex = readFiniteNumber(result.slotIndex);
  const slotsInEpoch = readFiniteNumber(result.slotsInEpoch);
  const absoluteSlot = readFiniteNumber(result.absoluteSlot);
  if (epoch === null || slotIndex === null || slotsInEpoch === null || absoluteSlot === null) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  const blockHeight = readFiniteNumber(result.blockHeight);
  const transactionCount = readFiniteNumber(result.transactionCount);

  return {
    network,
    epoch: Math.trunc(epoch),
    slotIndex: Math.trunc(slotIndex),
    slotsInEpoch: Math.trunc(slotsInEpoch),
    absoluteSlot: Math.trunc(absoluteSlot),
    blockHeight: blockHeight === null ? null : Math.trunc(blockHeight),
    transactionCount: transactionCount === null ? null : Math.trunc(transactionCount),
    fetchedAt: Date.now(),
  };
}

async function getRpcSlot(bindings: Bindings, network: Network): Promise<RpcSlotResponse> {
  const result = await heliusRpcRequest(bindings, network, 'getSlot', [
    { commitment: 'confirmed' },
  ]);
  const slot = readFiniteNumber(result);
  if (slot === null || slot < 0) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  return {
    network,
    slot: Math.trunc(slot),
    fetchedAt: Date.now(),
  };
}

function parseSignatureStatus(signature: string, value: unknown): RpcSignatureStatusRecord {
  if (!isRecord(value)) {
    return {
      signature,
      found: false,
      slot: null,
      confirmations: null,
      confirmationStatus: null,
      err: null,
    };
  }

  const slot = readFiniteNumber(value.slot);
  const confirmations = readFiniteNumber(value.confirmations);

  return {
    signature,
    found: true,
    slot: slot === null || slot < 0 ? null : Math.trunc(slot),
    confirmations: confirmations === null || confirmations < 0 ? null : Math.trunc(confirmations),
    confirmationStatus: sanitizeText(readString(value.confirmationStatus), 32),
    err: value.err ?? null,
  };
}

async function getRpcSignatureStatuses(
  bindings: Bindings,
  request: RpcSignatureStatusesRequest,
): Promise<RpcSignatureStatusesResponse> {
  const result = await heliusRpcRequest(bindings, request.network, 'getSignatureStatuses', [
    request.signatures,
    { searchTransactionHistory: true },
  ]);
  const values = isRecord(result) && Array.isArray(result.value) ? result.value : null;
  if (!values) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  return {
    network: request.network,
    statuses: request.signatures.map((signature, index) =>
      parseSignatureStatus(signature, values[index]),
    ),
    fetchedAt: Date.now(),
  };
}

function parseSignatureForAddressRecord(value: unknown): RpcSignatureForAddressRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const signature = readTrimmedString(value.signature);
  const slot = readFiniteNumber(value.slot);
  if (!signature || slot === null || slot < 0) {
    return null;
  }

  const blockTime = readFiniteNumber(value.blockTime);

  return {
    signature,
    slot: Math.trunc(slot),
    err: value.err ?? null,
    memo: sanitizeText(readString(value.memo), 160),
    blockTime: blockTime === null || blockTime < 0 ? null : Math.trunc(blockTime),
    confirmationStatus: sanitizeText(readString(value.confirmationStatus), 32),
  };
}

async function getRpcSignaturesForAddress(
  bindings: Bindings,
  request: RpcSignaturesForAddressRequest,
): Promise<RpcSignaturesForAddressResponse> {
  const limit = Math.min(100, Math.max(1, request.limit ?? DEFAULT_TRANSACTION_LIMIT));
  const result = await heliusRpcRequest(bindings, request.network, 'getSignaturesForAddress', [
    request.address,
    {
      commitment: 'confirmed',
      limit,
      ...(request.before ? { before: request.before } : {}),
    },
  ]);

  if (!Array.isArray(result)) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  return {
    network: request.network,
    address: request.address,
    signatures: result.flatMap((entry) => {
      const parsed = parseSignatureForAddressRecord(entry);
      return parsed ? [parsed] : [];
    }),
    fetchedAt: Date.now(),
  };
}

async function broadcastRawTransaction(
  bindings: Bindings,
  request: RawTransactionBroadcastRequest,
): Promise<RawTransactionBroadcastResponse> {
  const candidates = getRpcHttpUrlCandidates(bindings, request.network);
  let lastRetryableError: unknown = null;

  for (const candidate of candidates) {
    let response: Response;
    let payload: unknown = null;
    try {
      response = await heliusFetchImplementation(candidate.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `sendTransaction:${request.network}:${candidate.provider}`,
          method: 'sendTransaction',
          params: [
            request.rawTransaction,
            {
              encoding: 'base64',
              skipPreflight: true,
            },
          ],
        }),
      });
    } catch (error) {
      lastRetryableError = error;
      continue;
    }

    try {
      payload = (await response.json()) as unknown;
    } catch (error) {
      lastRetryableError = error;
      continue;
    }

    if (!isRecord(payload)) {
      lastRetryableError = payload;
      continue;
    }

    const signature = readTrimmedString(payload.result);
    if (signature) {
      return { signature };
    }

    const errorValue = isRecord(payload.error) ? payload.error : null;
    if (errorValue && response.ok) {
      if (isRetryableRpcError(errorValue)) {
        lastRetryableError = errorValue;
        continue;
      }

      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message:
          sanitizeText(readTrimmedString(errorValue.message), 160) ??
          'Transaction broadcast failed.',
        retryable: false,
      });
    }

    lastRetryableError = errorValue ?? payload;
  }

  throw toUpstreamUnavailable(
    null,
    'Transaction broadcaster is temporarily unavailable.',
    lastRetryableError ?? undefined,
  );
}

function sanitizeWalletToken(input: {
  mint: string;
  balance: string;
  decimals: number;
  name: string | null;
  symbol: string | null;
  logo: string | null;
  verified?: boolean;
  spam?: boolean;
}): WalletBalanceToken {
  const fallbackLabel = shortenAddress(input.mint);
  const name = sanitizeTokenLabel(input.name, fallbackLabel, 64);
  const symbol = sanitizeTokenLabel(input.symbol, fallbackLabel, 24);
  const spam = input.spam ?? isLikelySpamToken(name, symbol);
  const verified = input.verified ?? (!spam && input.name !== null && input.symbol !== null);

  return {
    mint: input.mint,
    name,
    symbol,
    logo: isHttpUrl(input.logo) ? input.logo : null,
    balance: input.balance,
    decimals: input.decimals,
    verified,
    spam,
  };
}

function sanitizeWalletTokenForNetwork(
  network: Network,
  input: Parameters<typeof sanitizeWalletToken>[0],
): WalletBalanceToken {
  if (isNativeSolMint(input.mint)) {
    return sanitizeWalletToken({
      ...input,
      mint: SOL_MINT,
      name: NATIVE_SOL_METADATA.name,
      symbol: NATIVE_SOL_METADATA.symbol,
      logo: NATIVE_SOL_METADATA.logo,
      decimals: SOL_DECIMALS,
      verified: true,
      spam: false,
    });
  }

  const canonical = CANONICAL_STABLECOIN_METADATA[network][input.mint];
  const normalizedInput: Parameters<typeof sanitizeWalletToken>[0] = {
    ...input,
    name: canonical?.name ?? input.name,
    symbol: canonical?.symbol ?? input.symbol,
    decimals: canonical?.decimals ?? input.decimals,
  };

  if (canonical != null) {
    normalizedInput.verified = true;
    normalizedInput.spam = false;
  }

  return sanitizeWalletToken(normalizedInput);
}

function parseTokenMetadataFromAsset(
  asset: unknown,
): { mint: string; metadata: TokenMetadata } | null {
  if (!isRecord(asset)) {
    return null;
  }

  const mint = readTrimmedString(asset.id);
  if (!mint || !isValidSolanaAddress(mint)) {
    return null;
  }

  const content = isRecord(asset.content) ? asset.content : null;
  const contentMetadata = content && isRecord(content.metadata) ? content.metadata : null;
  const contentLinks = content && isRecord(content.links) ? content.links : null;
  const tokenInfo = isRecord(asset.token_info) ? asset.token_info : null;

  const rawName =
    readString(contentMetadata?.name) ?? readString(tokenInfo?.name) ?? readString(asset.name);
  const rawSymbol =
    readString(tokenInfo?.symbol) ??
    readString(contentMetadata?.symbol) ??
    readString(asset.symbol);
  const name = sanitizeText(rawName, 64);
  const symbol = sanitizeText(rawSymbol, 24);
  const decimals = tokenInfo ? readFiniteNumber(tokenInfo.decimals) : null;
  const logo =
    readString(contentLinks?.image) ?? readString(asset.image) ?? readString(asset.logoURI) ?? null;
  const fallbackName = name ?? shortenAddress(mint);
  const fallbackSymbol = symbol ?? shortenAddress(mint);
  const spam = isLikelySpamToken(fallbackName, fallbackSymbol);

  return {
    mint,
    metadata: {
      name,
      symbol,
      logo: isHttpUrl(logo) ? logo : null,
      decimals: decimals !== null && decimals >= 0 && decimals <= 18 ? Math.trunc(decimals) : null,
      verified: !spam && (name !== null || symbol !== null),
      spam,
    },
  };
}

async function fetchTokenMetadataMap(
  bindings: Bindings,
  network: Network,
  mints: readonly string[],
): Promise<Map<string, TokenMetadata>> {
  const uniqueMints = Array.from(new Set(mints.filter((mint) => isValidSolanaAddress(mint))));
  const metadataByMint = new Map<string, TokenMetadata>();
  const missingMints: string[] = [];

  for (const mint of uniqueMints) {
    const cachedMetadata = memoryCache.get<TokenMetadata>(
      createNetworkCacheKey(network, 'token-metadata', [mint]),
    );
    if (cachedMetadata) {
      metadataByMint.set(mint, cachedMetadata);
    } else {
      missingMints.push(mint);
    }
  }

  if (missingMints.length === 0) {
    return metadataByMint;
  }

  try {
    const result = await heliusRpcRequest(bindings, network, 'getAssetBatch', {
      ids: missingMints,
    });
    const assets = Array.isArray(result) ? result : [];

    for (const asset of assets) {
      const parsed = parseTokenMetadataFromAsset(asset);
      if (parsed === null) {
        continue;
      }

      metadataByMint.set(parsed.mint, parsed.metadata);
      memoryCache.set(
        createNetworkCacheKey(network, 'token-metadata', [parsed.mint]),
        parsed.metadata,
        TOKEN_METADATA_CACHE_TTL_MS,
      );
    }
  } catch {
    return metadataByMint;
  }

  return metadataByMint;
}

function mergeWalletTokenMetadata(
  network: Network,
  token: Parameters<typeof sanitizeWalletToken>[0],
  metadata: TokenMetadata | null | undefined,
): WalletBalanceToken {
  const normalizedInput: Parameters<typeof sanitizeWalletToken>[0] = {
    ...token,
    name: metadata?.name ?? token.name,
    symbol: metadata?.symbol ?? token.symbol,
    logo: metadata?.logo ?? token.logo,
    decimals: metadata?.decimals ?? token.decimals,
  };

  if (metadata != null) {
    normalizedInput.verified = metadata.verified;
    normalizedInput.spam = metadata.spam;
  }

  return sanitizeWalletTokenForNetwork(network, normalizedInput);
}

function parseWalletApiBalancesPage(payload: unknown): {
  balances: WalletBalanceToken[];
  solBalance: number;
  hasMore: boolean;
} {
  if (!isRecord(payload)) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  const balancesValue = payload.balances;
  const paginationValue = payload.pagination;
  if (!Array.isArray(balancesValue)) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  let solBalance = 0;
  const tokens: WalletBalanceToken[] = [];

  for (const entry of balancesValue) {
    if (!isRecord(entry)) {
      continue;
    }

    const mint = readTrimmedString(entry.mint);
    const decimals = readFiniteNumber(entry.decimals);
    const balance = readFiniteNumber(entry.balance);
    const name = sanitizeText(readString(entry.name), 64);
    const symbol = sanitizeText(readString(entry.symbol), 24);

    if (!mint || decimals === null || balance === null || decimals < 0) {
      continue;
    }

    if (
      isHeliusNativeSolEntry({
        mint,
        name,
        symbol,
        decimals: Math.trunc(decimals),
      })
    ) {
      solBalance = bigintToSafeInteger(uiAmountToRawInteger(balance, Math.trunc(decimals)));
      continue;
    }

    tokens.push(
      sanitizeWalletTokenForNetwork('mainnet', {
        mint,
        balance: numberToDecimalString(balance),
        decimals: Math.trunc(decimals),
        name,
        symbol,
        logo: readString(entry.logoUri),
      }),
    );
  }

  const hasMore = isRecord(paginationValue) && readBoolean(paginationValue.hasMore) === true;

  return {
    balances: tokens,
    solBalance,
    hasMore,
  };
}

async function fetchWalletBalanceViaWalletApi(
  bindings: Bindings,
  address: string,
): Promise<WalletBalanceResponse> {
  const apiKey = getHeliusApiKey(bindings, 'mainnet');
  const tokens: WalletBalanceToken[] = [];
  let page = 1;
  let hasMore = true;
  let solBalance = 0;

  while (hasMore) {
    const url = new URL(`${MAINNET_WALLET_API_BASE_URL}/v1/wallet/${address}/balances`);
    url.searchParams.set('page', page.toString());
    url.searchParams.set('limit', '100');
    url.searchParams.set('showNative', 'true');
    url.searchParams.set('showNfts', 'false');
    url.searchParams.set('showZeroBalance', 'false');

    const payload = await fetchJson(
      url.toString(),
      {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
        },
      },
      'Wallet provider is temporarily unavailable.',
    );

    const parsedPage = parseWalletApiBalancesPage(payload);
    if (parsedPage.solBalance > 0) {
      solBalance = parsedPage.solBalance;
    }
    tokens.push(...parsedPage.balances);
    hasMore = parsedPage.hasMore;
    page += 1;
  }

  return {
    address,
    network: 'mainnet',
    solBalance,
    tokens,
    fetchedAt: Date.now(),
  };
}

async function fetchTokenAccountsForProgram(
  bindings: Bindings,
  network: Network,
  address: string,
  programId: string,
): Promise<BalanceAccumulator[]> {
  const result = await heliusRpcRequest(bindings, network, 'getTokenAccountsByOwner', [
    address,
    {
      programId,
    },
    {
      encoding: 'jsonParsed',
    },
  ]);

  if (!isRecord(result) || !Array.isArray(result.value)) {
    return [];
  }

  const accumulators = new Map<string, BalanceAccumulator>();

  for (const entry of result.value) {
    if (!isRecord(entry) || !isRecord(entry.account) || !isRecord(entry.account.data)) {
      continue;
    }

    const parsedData = isRecord(entry.account.data.parsed) ? entry.account.data.parsed : null;
    const info = parsedData && isRecord(parsedData.info) ? parsedData.info : null;
    const tokenAmount = info && isRecord(info.tokenAmount) ? info.tokenAmount : null;
    const mint = info ? readTrimmedString(info.mint) : null;
    const amount = tokenAmount ? readTrimmedString(tokenAmount.amount) : null;
    const decimals = tokenAmount ? readFiniteNumber(tokenAmount.decimals) : null;

    if (!mint || !amount || decimals === null || !/^\d+$/.test(amount)) {
      continue;
    }

    const normalizedDecimals = Math.trunc(decimals);
    const rawAmount = BigInt(amount);
    if (rawAmount <= 0n) {
      continue;
    }

    const existing = accumulators.get(mint);
    if (existing) {
      existing.rawAmount += rawAmount;
      continue;
    }

    accumulators.set(mint, {
      mint,
      decimals: normalizedDecimals,
      rawAmount,
    });
  }

  return Array.from(accumulators.values());
}

async function fetchTokenAccountAddressesForProgram(
  bindings: Bindings,
  network: Network,
  address: string,
  programId: string,
): Promise<WalletTokenAccountAddress[]> {
  const result = await heliusRpcRequest(bindings, network, 'getTokenAccountsByOwner', [
    address,
    {
      programId,
    },
    {
      encoding: 'jsonParsed',
    },
  ]);

  if (!isRecord(result) || !Array.isArray(result.value)) {
    return [];
  }

  const accounts: WalletTokenAccountAddress[] = [];
  for (const entry of result.value) {
    if (!isRecord(entry) || !isRecord(entry.account) || !isRecord(entry.account.data)) {
      continue;
    }

    const tokenAccountAddress = readTrimmedString(entry.pubkey);
    const parsedData = isRecord(entry.account.data.parsed) ? entry.account.data.parsed : null;
    const info = parsedData && isRecord(parsedData.info) ? parsedData.info : null;
    const mint = info ? readTrimmedString(info.mint) : null;

    if (!tokenAccountAddress || !mint) {
      continue;
    }

    accounts.push({
      address: tokenAccountAddress,
      mint,
      programId,
    });
  }

  return accounts;
}

async function getWalletTokenAccountAddresses(
  bindings: Bindings,
  address: string,
  network: Network,
): Promise<WalletTokenAccountAddress[]> {
  if (!isValidSolanaAddress(address)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Wallet address is invalid.',
    });
  }

  const [splAccounts, token2022Accounts] = await Promise.all([
    fetchTokenAccountAddressesForProgram(bindings, network, address, SPL_TOKEN_PROGRAM_ID),
    fetchTokenAccountAddressesForProgram(bindings, network, address, TOKEN_2022_PROGRAM_ID),
  ]);
  const seen = new Set<string>();
  return [...splAccounts, ...token2022Accounts].filter((account) => {
    if (seen.has(account.address)) return false;
    seen.add(account.address);
    return true;
  });
}

async function getWalletMintRawBalance(
  bindings: Bindings,
  request: WalletMintRawBalanceRequest,
): Promise<string> {
  if (!isValidSolanaAddress(request.address)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Wallet address is invalid.',
    });
  }

  if (!isValidSolanaAddress(request.mint)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Mint address is invalid.',
    });
  }

  const [splBalances, token2022Balances] = await Promise.all([
    fetchTokenAccountsForProgram(bindings, request.network, request.address, SPL_TOKEN_PROGRAM_ID),
    fetchTokenAccountsForProgram(bindings, request.network, request.address, TOKEN_2022_PROGRAM_ID),
  ]);

  let total = 0n;
  for (const entry of [...splBalances, ...token2022Balances]) {
    if (entry.mint === request.mint) {
      total += entry.rawAmount;
    }
  }

  return total.toString();
}

async function walletHasMintAccount(
  bindings: Bindings,
  request: WalletMintAccountExistsRequest,
): Promise<boolean> {
  if (!isValidSolanaAddress(request.address)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Wallet address is invalid.',
    });
  }

  if (!isValidSolanaAddress(request.mint)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Mint address is invalid.',
    });
  }

  const result = await heliusRpcRequest(bindings, request.network, 'getTokenAccountsByOwner', [
    request.address,
    {
      mint: request.mint,
    },
    {
      encoding: 'jsonParsed',
    },
  ]);

  return isRecord(result) && Array.isArray(result.value) && result.value.length > 0;
}

async function fetchWalletBalanceViaRpc(
  bindings: Bindings,
  address: string,
  network: Network,
): Promise<WalletBalanceResponse> {
  const [balanceResult, splBalances, token2022Balances] = await Promise.all([
    heliusRpcRequest(bindings, network, 'getBalance', [address, { commitment: 'confirmed' }]),
    fetchTokenAccountsForProgram(bindings, network, address, SPL_TOKEN_PROGRAM_ID),
    fetchTokenAccountsForProgram(bindings, network, address, TOKEN_2022_PROGRAM_ID),
  ]);

  const solBalance =
    isRecord(balanceResult) && readFiniteNumber(balanceResult.value) !== null
      ? Math.max(0, Math.trunc(readFiniteNumber(balanceResult.value) ?? 0))
      : 0;

  const tokenMap = new Map<string, BalanceAccumulator>();
  for (const entry of [...splBalances, ...token2022Balances]) {
    const existing = tokenMap.get(entry.mint);
    if (existing) {
      existing.rawAmount += entry.rawAmount;
      continue;
    }

    tokenMap.set(entry.mint, {
      ...entry,
    });
  }

  const sortedTokenBalances = Array.from(tokenMap.values()).sort((left, right) => {
    if (left.rawAmount === right.rawAmount) {
      return left.mint.localeCompare(right.mint);
    }

    return left.rawAmount > right.rawAmount ? -1 : 1;
  });
  const tokenMetadata = await fetchTokenMetadataMap(
    bindings,
    network,
    sortedTokenBalances.map((entry) => entry.mint),
  );
  const tokens = sortedTokenBalances
    .map((entry) =>
      mergeWalletTokenMetadata(
        network,
        {
          mint: entry.mint,
          balance: formatTokenAmount(entry.rawAmount, entry.decimals),
          decimals: entry.decimals,
          name: null,
          symbol: null,
          logo: null,
          verified: false,
          spam: false,
        },
        tokenMetadata.get(entry.mint),
      ),
    )
    .sort((left, right) => {
      const leftBalance = decimalStringToScaledInteger(left.balance, left.decimals);
      const rightBalance = decimalStringToScaledInteger(right.balance, right.decimals);
      if (leftBalance === rightBalance) {
        return left.symbol.localeCompare(right.symbol);
      }

      return leftBalance > rightBalance ? -1 : 1;
    });

  return {
    address,
    network,
    solBalance,
    tokens,
    fetchedAt: Date.now(),
  };
}

function extractEnhancedCounterparties(
  payload: Record<string, unknown>,
  walletAddress: string,
): WalletTransactionCounterparty[] {
  const counterparties: WalletTransactionCounterparty[] = [];

  const nativeTransfers = Array.isArray(payload.nativeTransfers) ? payload.nativeTransfers : [];
  for (const transfer of nativeTransfers) {
    if (!isRecord(transfer)) {
      continue;
    }

    appendCounterparty(
      counterparties,
      readTrimmedString(transfer.fromUserAccount),
      'sender',
      walletAddress,
    );
    appendCounterparty(
      counterparties,
      readTrimmedString(transfer.toUserAccount),
      'recipient',
      walletAddress,
    );
  }

  const tokenTransfers = Array.isArray(payload.tokenTransfers) ? payload.tokenTransfers : [];
  for (const transfer of tokenTransfers) {
    if (!isRecord(transfer)) {
      continue;
    }

    appendCounterparty(
      counterparties,
      readTrimmedString(transfer.fromUserAccount),
      'sender',
      walletAddress,
    );
    appendCounterparty(
      counterparties,
      readTrimmedString(transfer.toUserAccount),
      'recipient',
      walletAddress,
    );
  }

  appendCounterparty(
    counterparties,
    readTrimmedString(payload.feePayer),
    'fee_payer',
    walletAddress,
  );

  return counterparties;
}

function readEnhancedTokenTransferAmount(transfer: Record<string, unknown>): string | null {
  const rawTokenAmount = isRecord(transfer.rawTokenAmount) ? transfer.rawTokenAmount : null;
  const rawAmount = rawTokenAmount ? readTrimmedString(rawTokenAmount.tokenAmount) : null;
  const rawDecimals = rawTokenAmount ? readFiniteNumber(rawTokenAmount.decimals) : null;
  if (rawAmount && /^\d+$/.test(rawAmount) && rawDecimals !== null) {
    return formatTokenAmount(BigInt(rawAmount), Math.trunc(rawDecimals));
  }

  const numericAmount = readFiniteNumber(transfer.tokenAmount);
  if (numericAmount !== null && numericAmount >= 0) {
    return numberToDecimalString(numericAmount);
  }

  const stringAmount = readTrimmedString(transfer.tokenAmount);
  if (stringAmount && /^\d+(?:\.\d+)?$/.test(stringAmount)) {
    return stringAmount;
  }

  return null;
}

function extractEnhancedTokenMints(payload: unknown): string[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const mints = new Set<string>();
  for (const entry of payload) {
    if (!isRecord(entry) || !Array.isArray(entry.tokenTransfers)) {
      continue;
    }

    for (const transfer of entry.tokenTransfers) {
      if (!isRecord(transfer)) {
        continue;
      }

      const mint = readTrimmedString(transfer.mint);
      if (mint && isValidSolanaAddress(mint)) {
        mints.add(mint);
      }
    }
  }

  return [...mints];
}

function resolveEnhancedTokenSymbol(
  transfer: Record<string, unknown>,
  metadataByMint: ReadonlyMap<string, TokenMetadata>,
): string {
  const mint = readTrimmedString(transfer.mint);
  const providerSymbol =
    readString(transfer.symbol) ??
    readString(transfer.tokenSymbol) ??
    readString(transfer.token_symbol);
  const metadataSymbol = mint ? metadataByMint.get(mint)?.symbol : null;
  return sanitizeTokenLabel(
    providerSymbol ?? metadataSymbol,
    mint ? shortenAddress(mint) : 'TOKEN',
    24,
  );
}

function resolveTransactionTokenFields(
  network: Network,
  mint: string | null,
  decimals: number | null,
  rawAmount: bigint | null,
  direction: 'send' | 'receive' | null,
  metadataByMint: ReadonlyMap<string, TokenMetadata>,
): TransactionTokenFields {
  if (!mint || !isValidSolanaAddress(mint) || decimals === null || rawAmount === null) {
    return {
      amount: null,
      rawAmount: null,
      tokenMint: null,
      tokenSymbol: null,
      tokenName: null,
      tokenLogo: null,
      tokenDecimals: null,
      direction,
    };
  }

  const normalizedDecimals = Math.max(0, Math.min(18, Math.trunc(decimals)));
  const absoluteAmount = rawAmount < 0n ? -rawAmount : rawAmount;
  const metadata = mergeWalletTokenMetadata(
    network,
    {
      mint,
      balance: '0',
      decimals: normalizedDecimals,
      name: null,
      symbol: null,
      logo: null,
      verified: false,
      spam: false,
    },
    metadataByMint.get(mint),
  );

  return {
    amount: formatTokenAmount(absoluteAmount, normalizedDecimals),
    rawAmount: absoluteAmount.toString(),
    tokenMint: metadata.mint,
    tokenSymbol: metadata.symbol,
    tokenName: metadata.name,
    tokenLogo: metadata.logo,
    tokenDecimals: metadata.decimals,
    direction,
  };
}

function readEnhancedTokenTransferRawAmount(
  transfer: Record<string, unknown>,
): { rawAmount: bigint; decimals: number } | null {
  const rawTokenAmount = isRecord(transfer.rawTokenAmount) ? transfer.rawTokenAmount : null;
  const rawAmount = rawTokenAmount ? readTrimmedString(rawTokenAmount.tokenAmount) : null;
  const rawDecimals = rawTokenAmount ? readFiniteNumber(rawTokenAmount.decimals) : null;
  if (rawAmount && /^\d+$/.test(rawAmount) && rawDecimals !== null) {
    return {
      rawAmount: BigInt(rawAmount),
      decimals: Math.trunc(rawDecimals),
    };
  }

  const amount = readEnhancedTokenTransferAmount(transfer);
  if (amount === null) return null;

  const mint = readTrimmedString(transfer.mint);
  const decimals = mint ? (CANONICAL_STABLECOIN_METADATA.mainnet[mint]?.decimals ?? 9) : 9;
  return {
    rawAmount: decimalStringToScaledInteger(amount, decimals),
    decimals,
  };
}

function readEnhancedNativeTransferRawAmount(transfer: Record<string, unknown>): bigint | null {
  return readNonNegativeBigInt(transfer.amount) ?? readNonNegativeBigInt(transfer.lamports);
}

function getEnhancedInstructionRecords(
  payload: Record<string, unknown>,
): Record<string, unknown>[] {
  const instructions = Array.isArray(payload.instructions) ? payload.instructions : [];
  return instructions.filter(isRecord);
}

function readEnhancedParsedInstructionType(instruction: Record<string, unknown>): string | null {
  const parsed = isRecord(instruction.parsed) ? instruction.parsed : null;
  return parsed ? (readTrimmedString(parsed.type)?.toLowerCase() ?? null) : null;
}

function enhancedInstructionInfo(
  instruction: Record<string, unknown>,
): Record<string, unknown> | null {
  const parsed = isRecord(instruction.parsed) ? instruction.parsed : null;
  return parsed && isRecord(parsed.info) ? parsed.info : null;
}

function buildEnhancedTransactionTokenFields(
  network: Network,
  payload: Record<string, unknown>,
  walletAddress: string,
  metadataByMint: ReadonlyMap<string, TokenMetadata>,
): TransactionTokenFields {
  const tokenTransfers = Array.isArray(payload.tokenTransfers) ? payload.tokenTransfers : [];
  const nativeTransfers = Array.isArray(payload.nativeTransfers) ? payload.nativeTransfers : [];
  const debits: Array<{ mint: string; rawAmount: bigint; decimals: number }> = [];
  const credits: Array<{ mint: string; rawAmount: bigint; decimals: number }> = [];

  for (const transfer of tokenTransfers) {
    if (!isRecord(transfer)) {
      continue;
    }

    const mint = readTrimmedString(transfer.mint);
    const amount = readEnhancedTokenTransferRawAmount(transfer);
    if (!mint || !isValidSolanaAddress(mint) || amount === null || amount.rawAmount === 0n) {
      continue;
    }

    if (readTrimmedString(transfer.fromUserAccount) === walletAddress) {
      debits.push({ mint, ...amount });
    }
    if (readTrimmedString(transfer.toUserAccount) === walletAddress) {
      credits.push({ mint, ...amount });
    }
  }

  for (const transfer of nativeTransfers) {
    if (!isRecord(transfer)) {
      continue;
    }

    const rawAmount = readEnhancedNativeTransferRawAmount(transfer);
    if (rawAmount === null || rawAmount === 0n) {
      continue;
    }

    const nativeDelta = {
      mint: SOL_MINT,
      rawAmount,
      decimals: SOL_DECIMALS,
    };
    if (readTrimmedString(transfer.fromUserAccount) === walletAddress) {
      debits.push(nativeDelta);
    }
    if (readTrimmedString(transfer.toUserAccount) === walletAddress) {
      credits.push(nativeDelta);
    }
  }

  const primaryCredit = credits[0] ?? null;
  const primaryDebit = debits[0] ?? null;
  const primary = primaryCredit ?? primaryDebit;
  const direction =
    primaryCredit != null && primaryDebit == null
      ? 'receive'
      : primaryDebit != null && primaryCredit == null
        ? 'send'
        : null;

  return resolveTransactionTokenFields(
    network,
    primary?.mint ?? null,
    primary?.decimals ?? null,
    primary?.rawAmount ?? null,
    direction,
    metadataByMint,
  );
}

function isEnhancedNativeAccountSetupDebit(
  payload: Record<string, unknown>,
  walletAddress: string,
  tokenFields: TransactionTokenFields,
): boolean {
  if (!isNativeSolMint(tokenFields.tokenMint) || tokenFields.direction !== 'send') {
    return false;
  }

  const rawAmount = readNonNegativeBigInt(tokenFields.rawAmount);
  const instructions = getEnhancedInstructionRecords(payload);
  let walletFundedNewAccount = false;
  let initializedNonceAccount = false;

  for (const instruction of instructions) {
    const type = readEnhancedParsedInstructionType(instruction);
    const info = enhancedInstructionInfo(instruction);
    if (type == null || info == null) continue;

    if (type === 'createaccount' || type === 'createaccountwithseed') {
      const source = readTrimmedString(info.source);
      const lamports = readNonNegativeBigInt(info.lamports);
      if (
        source === walletAddress &&
        (rawAmount === null || lamports === null || lamports === rawAmount)
      ) {
        walletFundedNewAccount = true;
      }
    }

    if (type === 'initializenonce') {
      const nonceAuthority = readTrimmedString(info.nonceAuthority);
      if (nonceAuthority === walletAddress) {
        initializedNonceAccount = true;
      }
    }
  }

  return walletFundedNewAccount || initializedNonceAccount;
}

function classifyEnhancedTransactionType(
  payload: Record<string, unknown>,
  walletAddress: string,
  providerType: string,
  tokenFields: TransactionTokenFields,
): string {
  if (isEnhancedNativeAccountSetupDebit(payload, walletAddress, tokenFields)) {
    return 'ACCOUNT_SETUP';
  }

  if (providerType !== 'UNKNOWN') {
    return providerType;
  }

  const instructionTypes = getEnhancedInstructionRecords(payload)
    .map(readEnhancedParsedInstructionType)
    .filter((type): type is string => type != null);

  if (
    instructionTypes.some(
      (type) =>
        type === 'transfer' ||
        type === 'transferchecked' ||
        type === 'withdrawfromnonce' ||
        type === 'closeaccount',
    )
  ) {
    return 'TRANSFER';
  }

  if (
    tokenFields.tokenMint != null &&
    !isNativeSolMint(tokenFields.tokenMint) &&
    tokenFields.direction != null
  ) {
    return 'TOKEN_TRANSFER';
  }

  return providerType;
}

function classifyRpcNativeSolInstructionActivity(
  result: unknown,
  walletAddress: string,
): 'transfer' | 'account_setup' | 'hidden' {
  if (!isRecord(result)) {
    return 'hidden';
  }

  const transaction = isRecord(result.transaction) ? result.transaction : null;
  const message = transaction && isRecord(transaction.message) ? transaction.message : null;
  const instructions = message && Array.isArray(message.instructions) ? message.instructions : [];
  const meta = isRecord(result.meta) ? result.meta : null;
  const parsedInstructions = collectRpcParsedInstructions(instructions, meta);
  let walletFundedNewAccount = false;
  let initializedNonceAccount = false;
  let walletSystemTransfer = false;
  let walletNonceWithdrawal = false;

  for (const instruction of parsedInstructions) {
    if (!isRecord(instruction)) {
      continue;
    }
    const program = readTrimmedString(instruction.program)?.toLowerCase() ?? '';
    const parsed = isRecord(instruction.parsed) ? instruction.parsed : null;
    const type = parsed ? (readTrimmedString(parsed.type)?.toLowerCase() ?? '') : '';
    const info = parsed && isRecord(parsed.info) ? parsed.info : null;

    if (program === 'system' && info != null) {
      if (type === 'createaccount' || type === 'createaccountwithseed') {
        if (readTrimmedString(info.source) === walletAddress) {
          walletFundedNewAccount = true;
        }
      }

      if (type === 'initializenonce') {
        if (readTrimmedString(info.nonceAuthority) === walletAddress) {
          initializedNonceAccount = true;
        }
      }

      if (type === 'transfer') {
        if (
          readTrimmedString(info.source) === walletAddress ||
          readTrimmedString(info.destination) === walletAddress
        ) {
          walletSystemTransfer = true;
        }
      }

      if (type === 'withdrawfromnonce') {
        if (
          readTrimmedString(info.nonceAuthority) === walletAddress ||
          readTrimmedString(info.recipient) === walletAddress
        ) {
          walletNonceWithdrawal = true;
        }
      }
    }
  }

  if (walletFundedNewAccount || initializedNonceAccount) {
    return 'account_setup';
  }

  if (walletSystemTransfer || walletNonceWithdrawal) {
    return 'transfer';
  }

  return 'hidden';
}

async function refineEnhancedNativeSolUnknownRecords(
  bindings: Bindings,
  network: Network,
  walletAddress: string,
  records: WalletTransactionRecord[],
): Promise<void> {
  const candidates = records
    .map((record, index) => ({ record, index }))
    .filter(
      ({ record }) =>
        record.type === 'UNKNOWN' &&
        isNativeSolMint(record.tokenMint) &&
        record.direction != null &&
        record.signature.trim().length > 0,
    );
  if (candidates.length === 0) {
    return;
  }

  try {
    const results = await heliusRpcBatchRequest(
      bindings,
      network,
      candidates.map(({ record }, index) => ({
        id: `enhanced-native-unknown:${index}`,
        method: 'getTransaction',
        params: [
          record.signature,
          {
            commitment: 'confirmed',
            encoding: 'jsonParsed',
            maxSupportedTransactionVersion: 0,
          },
        ],
      })),
    );

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (candidate == null) continue;
      const classification = classifyRpcNativeSolInstructionActivity(results[index], walletAddress);
      if (classification === 'transfer') {
        candidate.record.type = 'TRANSFER';
      } else if (classification === 'account_setup') {
        candidate.record.type = 'ACCOUNT_SETUP';
      }
    }
  } catch {
    // Keep unresolved UNKNOWN native-SOL rows hidden by the display filter.
  }
}

function findCounterpartyAddress(
  counterparties: readonly WalletTransactionCounterparty[],
  rolePattern: RegExp,
): string | null {
  return (
    counterparties.find((counterparty) => rolePattern.test(counterparty.role))?.address ?? null
  );
}

function isDisplayableWalletTransactionRecord(transaction: WalletTransactionRecord): boolean {
  const normalizedType = transaction.type.trim().toLowerCase();
  if (
    normalizedType.includes('setup') ||
    normalizedType.includes('registration') ||
    normalizedType.includes('rent')
  ) {
    return false;
  }

  // A row is displayable if it carries a concrete token amount AND it is either
  // a directional transfer (send/receive) or a swap. Swaps legitimately have a
  // null direction (both a debit and a credit leg), so direction is NOT part of
  // the amount check — otherwise the trailing swap check below is unreachable
  // and every swap is dropped.
  const hasTokenAmount = Boolean(
    transaction.tokenMint?.trim() && (transaction.amount?.trim() || transaction.rawAmount?.trim()),
  );
  if (!hasTokenAmount) {
    return false;
  }

  if (isNativeSolMint(transaction.tokenMint) && normalizedType === 'unknown') {
    return false;
  }

  if (
    isNativeSolMint(transaction.tokenMint) &&
    transaction.counterparties.some((counterparty) =>
      /umbra_pool|umbra_program/.test(counterparty.role),
    )
  ) {
    return false;
  }

  return (
    transaction.direction === 'send' ||
    transaction.direction === 'receive' ||
    normalizedType.includes('swap')
  );
}

interface ParsedDisplayAmount {
  rawAmount: string;
  amount: string;
  symbol: string;
}

interface DisplayTokenMetadata {
  mint: string | null;
  symbol: string | null;
  name: string | null;
  logo: string | null;
}

const DISPLAY_TOKEN_AMOUNT_PATTERN = /([+-]?\d[\d,]*(?:\.\d+)?)\s+([A-Za-z][A-Za-z0-9]{1,15})/g;
const DISPLAY_SEND_ROLE_SEGMENTS = new Set(['recipient', 'receiver', 'destination', 'to']);
const DISPLAY_RECEIVE_ROLE_SEGMENTS = new Set(['sender', 'source', 'from', 'payer']);
const DISPLAY_ROUTE_ROLE_SEGMENTS = new Set(['route', 'program', 'protocol', 'provider']);
const DISPLAY_GENERIC_COUNTERPARTY_ROLES = new Set([
  'account',
  'authority',
  'counterparty',
  'destination',
  'from',
  'owner',
  'payer',
  'receiver',
  'recipient',
  'sender',
  'source',
  'to',
  'unknown',
  'wallet',
]);
const DISPLAY_SWAP_SIGNAL_PATTERN =
  /(?:^|[^a-z0-9])(swap|swapped|jupiter|raydium|orca|meteora|phoenix|openbook)(?:$|[^a-z0-9])/i;

function normalizeDisplayTokenSymbol(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function normalizeDisplayTokenMint(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return isNativeSolMint(trimmed) ? SOL_MINT : trimmed;
}

function formatDisplayDecimalAmount(value: string): string {
  const parsed = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) {
    return value.replace(/^[+-]/, '');
  }

  const absolute = Math.abs(Object.is(parsed, -0) ? 0 : parsed);
  if (absolute !== 0 && absolute < 0.000001) {
    return '<0.000001';
  }

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
  }).format(absolute);
}

function formatRawTokenDisplayAmount(
  rawAmount: string | null | undefined,
  decimals: number | null | undefined,
): string | null {
  const trimmed = rawAmount?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null;
  }

  return formatTokenAmount(BigInt(trimmed), decimals ?? 0);
}

function parseDisplayTokenAmounts(description: string | null | undefined): ParsedDisplayAmount[] {
  if (!description) return [];

  const matches: ParsedDisplayAmount[] = [];
  for (const match of description.matchAll(DISPLAY_TOKEN_AMOUNT_PATTERN)) {
    const rawAmount = match[1]?.replace(/,/g, '') ?? '';
    const symbol = normalizeDisplayTokenSymbol(match[2]) ?? '';
    const parsed = Number(rawAmount);
    if (!Number.isFinite(parsed) || symbol.length === 0) continue;

    matches.push({
      rawAmount,
      amount: formatDisplayDecimalAmount(rawAmount),
      symbol,
    });
  }

  return matches;
}

function resolveDisplayTokenSymbol(
  transaction: WalletTransactionRecord,
  fallback: string | null = null,
): string | null {
  return (
    normalizeDisplayTokenSymbol(transaction.tokenSymbol) ??
    (isNativeSolMint(transaction.tokenMint) ? 'SOL' : fallback)
  );
}

function resolveDisplayTokenMetadata(
  transaction: WalletTransactionRecord,
  amounts: readonly ParsedDisplayAmount[],
): DisplayTokenMetadata {
  const fallbackSymbol = amounts[0]?.symbol ?? null;
  const symbol = resolveDisplayTokenSymbol(transaction, fallbackSymbol);
  const mint =
    normalizeDisplayTokenMint(transaction.tokenMint) ?? (symbol === 'SOL' ? SOL_MINT : null);
  const tokenName =
    sanitizeText(transaction.tokenName, 80) ?? (symbol === 'SOL' ? 'Solana' : symbol);
  const tokenLogo = isHttpUrl(transaction.tokenLogo) ? transaction.tokenLogo : null;

  return {
    mint,
    symbol,
    name: tokenName,
    logo: tokenLogo,
  };
}

function roleSegments(role: string): string[] {
  return role
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+|_+/)
    .filter(Boolean);
}

function roleHasSegment(role: string, segments: ReadonlySet<string>): boolean {
  return roleSegments(role).some((segment) => segments.has(segment));
}

function isGenericDisplayCounterpartyRole(role: string): boolean {
  const normalizedRole = roleSegments(role).join(' ');
  return (
    DISPLAY_GENERIC_COUNTERPARTY_ROLES.has(normalizedRole) ||
    roleHasSegment(role, DISPLAY_SEND_ROLE_SEGMENTS) ||
    roleHasSegment(role, DISPLAY_RECEIVE_ROLE_SEGMENTS)
  );
}

function hasDisplaySwapSignal(transaction: WalletTransactionRecord): boolean {
  const counterpartySignal = transaction.counterparties
    .map((counterparty) => `${counterparty.role} ${counterparty.address}`)
    .join(' ');
  return DISPLAY_SWAP_SIGNAL_PATTERN.test(
    `${transaction.type} ${transaction.description ?? ''} ${counterpartySignal}`,
  );
}

function inferDisplayType(
  transaction: WalletTransactionRecord,
  amounts: readonly ParsedDisplayAmount[],
): WalletTransactionDisplayType {
  if (hasDisplaySwapSignal(transaction)) {
    return 'swap';
  }

  const normalized = `${transaction.type} ${transaction.description ?? ''}`.toLowerCase();
  if (amounts.length >= 2 && /\bto\b|\bfor\b/.test(transaction.description ?? '')) {
    return 'swap';
  }
  if (
    normalized.includes('receive') ||
    normalized.includes('deposit') ||
    normalized.includes('inbound')
  ) {
    return 'receive';
  }
  if (amounts[0]?.rawAmount.startsWith('+')) {
    return 'receive';
  }

  const hasSenderCounterparty = transaction.counterparties.some((counterparty) =>
    roleHasSegment(counterparty.role, DISPLAY_RECEIVE_ROLE_SEGMENTS),
  );
  const hasRecipientCounterparty = transaction.counterparties.some((counterparty) =>
    roleHasSegment(counterparty.role, DISPLAY_SEND_ROLE_SEGMENTS),
  );
  if (hasSenderCounterparty !== hasRecipientCounterparty) {
    return hasSenderCounterparty ? 'receive' : 'send';
  }

  return 'send';
}

function getDisplayType(
  transaction: WalletTransactionRecord,
  amounts: readonly ParsedDisplayAmount[],
): WalletTransactionDisplayType {
  const inferred = inferDisplayType(transaction, amounts);
  if (inferred === 'swap') return 'swap';
  if (transaction.direction === 'send' || transaction.direction === 'receive') {
    return transaction.direction;
  }
  return inferred;
}

function parseWalletTransactionDisplayAmounts(
  transaction: WalletTransactionRecord,
): ParsedDisplayAmount[] {
  const descriptionAmounts = parseDisplayTokenAmounts(transaction.description);
  if (descriptionAmounts.length > 0) return descriptionAmounts;

  const amount =
    transaction.amount?.trim() ??
    formatRawTokenDisplayAmount(transaction.rawAmount, transaction.tokenDecimals);
  const symbol = resolveDisplayTokenSymbol(transaction);
  if (!amount || !symbol) return [];

  const parsed = Number(amount.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) return [];

  return [
    {
      rawAmount:
        transaction.direction === 'receive' ? `+${Math.abs(parsed)}` : `-${Math.abs(parsed)}`,
      amount: formatDisplayDecimalAmount(String(Math.abs(parsed))),
      symbol,
    },
  ];
}

function getDisplayTitle(
  type: WalletTransactionDisplayType,
  status: WalletTransactionRecord['status'],
): string {
  if (status === 'failed') return 'Failed';
  if (type === 'receive') return 'Received';
  if (type === 'swap') return 'Swapped';
  return 'Sent';
}

function buildDisplayCounterpartyName(counterparty: WalletTransactionCounterparty): string {
  const role = counterparty.role.trim();
  const address = shortenAddress(counterparty.address);
  if (role.length > 0 && !isGenericDisplayCounterpartyRole(role)) {
    return `${role} (${address})`;
  }
  return address;
}

function findDisplayCounterparty(
  type: WalletTransactionDisplayType,
  counterparties: readonly WalletTransactionCounterparty[],
): WalletTransactionCounterparty | null {
  const directionalSegments =
    type === 'send'
      ? DISPLAY_SEND_ROLE_SEGMENTS
      : type === 'receive'
        ? DISPLAY_RECEIVE_ROLE_SEGMENTS
        : null;

  if (directionalSegments !== null) {
    const directional = counterparties.find((counterparty) =>
      roleHasSegment(counterparty.role, directionalSegments),
    );
    if (directional) return directional;
  }

  return (
    counterparties.find(
      (counterparty) => !roleHasSegment(counterparty.role, DISPLAY_ROUTE_ROLE_SEGMENTS),
    ) ??
    counterparties[0] ??
    null
  );
}

function buildDisplaySubtitle(
  type: WalletTransactionDisplayType,
  transaction: WalletTransactionRecord,
): string {
  const counterparty = findDisplayCounterparty(type, transaction.counterparties);
  const direction = type === 'receive' ? 'From' : type === 'send' ? 'To' : 'With';

  if (counterparty) {
    return `${direction} ${buildDisplayCounterpartyName(counterparty)}`;
  }
  if (transaction.description != null && /multiple accounts/i.test(transaction.description)) {
    return `${direction} multiple accounts`;
  }

  return `Tx ${shortenAddress(transaction.signature)}`;
}

function buildDisplaySwapSubtitle(amounts: readonly ParsedDisplayAmount[]): string | null {
  const [input, output] = amounts;
  if (!input || !output) return null;
  return `${input.amount} ${input.symbol} to ${output.amount} ${output.symbol}`;
}

function buildDisplayAmountFields(
  type: WalletTransactionDisplayType,
  transaction: WalletTransactionRecord,
  amounts: readonly ParsedDisplayAmount[],
  token: DisplayTokenMetadata,
): Pick<
  WalletTransactionView,
  | 'amountLabel'
  | 'secondaryAmountLabel'
  | 'amountTone'
  | 'tokenMint'
  | 'tokenSymbol'
  | 'tokenName'
  | 'tokenLogo'
> {
  const primarySymbol = token.symbol ?? amounts[0]?.symbol ?? null;
  const primaryName = token.name ?? primarySymbol;

  if (transaction.status === 'failed') {
    return {
      amountLabel: 'Failed',
      secondaryAmountLabel: null,
      amountTone: 'failed',
      tokenMint: token.mint,
      tokenSymbol: primarySymbol,
      tokenName: primaryName,
      tokenLogo: token.logo,
    };
  }

  if (type === 'swap') {
    const [input, output] = amounts;
    if (input && output) {
      const outputMetadataMatches = token.symbol === output.symbol;
      return {
        amountLabel: `+${output.amount} ${output.symbol}`,
        secondaryAmountLabel: `-${input.amount} ${input.symbol}`,
        amountTone: 'positive',
        tokenMint: outputMetadataMatches ? token.mint : null,
        tokenSymbol: output.symbol,
        tokenName: outputMetadataMatches ? (token.name ?? output.symbol) : output.symbol,
        tokenLogo: outputMetadataMatches ? token.logo : null,
      };
    }
  }

  const amount = amounts[0];
  if (!amount) {
    return {
      amountLabel: null,
      secondaryAmountLabel: null,
      amountTone: 'neutral',
      tokenMint: token.mint,
      tokenSymbol: primarySymbol,
      tokenName: primaryName,
      tokenLogo: token.logo,
    };
  }

  const sign = type === 'receive' ? '+' : '-';
  return {
    amountLabel: `${sign}${amount.amount} ${amount.symbol}`,
    secondaryAmountLabel: null,
    amountTone: type === 'receive' ? 'positive' : 'negative',
    tokenMint: token.mint,
    tokenSymbol: primarySymbol ?? amount.symbol,
    tokenName: primaryName ?? amount.symbol,
    tokenLogo: token.logo,
  };
}

function getDisplayAccountLabel(type: WalletTransactionDisplayType): string {
  if (type === 'receive') return 'From';
  if (type === 'send') return 'To';
  return 'With';
}

function buildWalletTransactionView(
  transaction: WalletTransactionRecord,
  network: Network,
): WalletTransactionView {
  const amounts = parseWalletTransactionDisplayAmounts(transaction);
  const type = getDisplayType(transaction, amounts);
  const token = resolveDisplayTokenMetadata(transaction, amounts);
  const amountFields = buildDisplayAmountFields(type, transaction, amounts, token);
  const swapSubtitle = type === 'swap' ? buildDisplaySwapSubtitle(amounts) : null;
  const account = findDisplayCounterparty(type, transaction.counterparties);

  return {
    id: transaction.signature,
    type,
    title: getDisplayTitle(type, transaction.status),
    subtitle: swapSubtitle ?? buildDisplaySubtitle(type, transaction),
    sourceLabel: null,
    ...amountFields,
    status: transaction.status === 'failed' ? 'failed' : 'confirmed',
    detailTimestampMs: transaction.timestamp > 0 ? transaction.timestamp * 1000 : null,
    detailNetwork: network,
    detailSignature: transaction.signature,
    detailAccountLabel: getDisplayAccountLabel(type),
    detailAccountAddress: account?.address?.trim() || null,
  };
}

function formatHistoryGroupTitle(timestampSeconds: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(timestampSeconds * 1000));
}

function sortWalletTransactionsMostRecent(
  transactions: readonly WalletTransactionRecord[],
): WalletTransactionRecord[] {
  return [...transactions].sort((left, right) => {
    const timestampDiff = right.timestamp - left.timestamp;
    if (timestampDiff !== 0) return timestampDiff;
    return left.signature.localeCompare(right.signature);
  });
}

function buildHistoryGroupsFromDisplayRows(
  transactions: readonly WalletTransactionRecord[],
): WalletTransactionGroup[] {
  const groups = new Map<string, WalletTransactionView[]>();
  for (const transaction of transactions) {
    const display = transaction.display;
    if (!display) continue;
    const title = formatHistoryGroupTitle(transaction.timestamp);
    const group = groups.get(title) ?? [];
    group.push(display);
    groups.set(title, group);
  }

  return Array.from(groups.entries()).map(([title, data]) => ({ title, data }));
}

function buildWalletTransactionsResponse(params: {
  address: string;
  network: Network;
  transactions: readonly WalletTransactionRecord[];
  cursor: string | null;
}): WalletTransactionsResponse {
  const transactions = sortWalletTransactionsMostRecent(params.transactions).map((transaction) => {
    const display = transaction.display ?? buildWalletTransactionView(transaction, params.network);
    return { ...transaction, display };
  });

  return {
    address: params.address,
    network: params.network,
    transactions,
    displayTransactions: transactions.map((transaction) => transaction.display!),
    historyGroups: buildHistoryGroupsFromDisplayRows(transactions),
    cursor: params.cursor,
    fetchedAt: Date.now(),
  };
}

function buildEnhancedTokenDescription(
  payload: Record<string, unknown>,
  walletAddress: string,
  metadataByMint: ReadonlyMap<string, TokenMetadata>,
): string | null {
  const tokenTransfers = Array.isArray(payload.tokenTransfers) ? payload.tokenTransfers : [];
  const nativeTransfers = Array.isArray(payload.nativeTransfers) ? payload.nativeTransfers : [];
  const debits: string[] = [];
  const credits: string[] = [];

  for (const transfer of tokenTransfers) {
    if (!isRecord(transfer)) {
      continue;
    }

    const amount = readEnhancedTokenTransferAmount(transfer);
    if (amount === null || Number(amount) === 0) {
      continue;
    }

    const symbol = resolveEnhancedTokenSymbol(transfer, metadataByMint);
    const formattedAmount = `${formatTokenAmount(
      decimalStringToScaledInteger(amount, 9),
      9,
    )} ${symbol}`;
    if (readTrimmedString(transfer.fromUserAccount) === walletAddress) {
      debits.push(formattedAmount);
    }
    if (readTrimmedString(transfer.toUserAccount) === walletAddress) {
      credits.push(formattedAmount);
    }
  }

  for (const transfer of nativeTransfers) {
    if (!isRecord(transfer)) {
      continue;
    }

    const rawAmount = readEnhancedNativeTransferRawAmount(transfer);
    if (rawAmount === null || rawAmount === 0n) {
      continue;
    }

    const formattedAmount = `${formatTokenAmount(rawAmount, SOL_DECIMALS)} SOL`;
    if (readTrimmedString(transfer.fromUserAccount) === walletAddress) {
      debits.push(formattedAmount);
    }
    if (readTrimmedString(transfer.toUserAccount) === walletAddress) {
      credits.push(formattedAmount);
    }
  }

  if (debits.length > 0 && credits.length > 0) {
    return `Swapped ${debits[0]} to ${credits[0]}`;
  }

  if (credits.length > 0) {
    return `Received ${credits[0]}`;
  }

  if (debits.length > 0) {
    return `Sent ${debits[0]}`;
  }

  return null;
}

function parseEnhancedTransactions(
  payload: unknown,
  network: Network,
  walletAddress: string,
  metadataByMint: ReadonlyMap<string, TokenMetadata>,
): WalletTransactionRecord[] {
  if (!Array.isArray(payload)) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  const transactions: WalletTransactionRecord[] = [];

  for (const entry of payload) {
    if (!isRecord(entry)) {
      continue;
    }

    const signature = readTrimmedString(entry.signature);
    const timestamp = readFiniteNumber(entry.timestamp);
    const fee = readFiniteNumber(entry.fee);

    if (!signature || timestamp === null || fee === null || timestamp <= 0 || fee < 0) {
      continue;
    }

    const touchesUmbra = transactionTouchesUmbraProgram(entry, network);
    const counterparties = touchesUmbra
      ? mergeCounterparties(
          extractEnhancedCounterparties(entry, walletAddress),
          extractUmbraPoolCounterparties(entry, network, walletAddress),
        )
      : extractEnhancedCounterparties(entry, walletAddress);
    const tokenFields = buildEnhancedTransactionTokenFields(
      network,
      entry,
      walletAddress,
      metadataByMint,
    );
    const providerType = classifyEnhancedTransactionType(
      entry,
      walletAddress,
      sanitizeProviderTransactionType(readString(entry.type)),
      tokenFields,
    );
    const providerDescription =
      buildEnhancedTokenDescription(entry, walletAddress, metadataByMint) ??
      sanitizeText(readString(entry.description), 240);
    const umbraInstructionNames = touchesUmbra ? extractUmbraInstructionNames(entry) : [];
    const umbraClassification = touchesUmbra
      ? classifyUmbraTransaction(
          tokenFields.direction,
          providerType,
          providerDescription,
          umbraInstructionNames,
        )
      : null;
    const sender =
      findCounterpartyAddress(counterparties, /sender|source|from|payer/) ??
      (tokenFields.direction === 'send' ? walletAddress : null);
    const recipient =
      findCounterpartyAddress(counterparties, /recipient|receiver|destination|to/) ??
      (tokenFields.direction === 'receive' ? walletAddress : null);

    transactions.push({
      signature,
      timestamp: Math.trunc(timestamp),
      type: umbraClassification?.type ?? providerType,
      description: umbraClassification?.description ?? providerDescription,
      ...tokenFields,
      fee: Math.trunc(fee),
      status:
        entry.transactionError !== null && entry.transactionError !== undefined
          ? 'failed'
          : 'success',
      sender,
      recipient,
      counterparties,
    });
  }

  return transactions;
}

interface EnhancedRestTransactionPage {
  records: WalletTransactionRecord[];
  rawCount: number;
  nextCursor: string | null;
}

async function fetchEnhancedRestTransactionsPage(
  bindings: Bindings,
  network: Network,
  address: string,
  cursor: string | null,
  limit: number,
): Promise<EnhancedRestTransactionPage> {
  const apiKey = getHeliusApiKey(bindings, network);
  const url = new URL(
    `${getEnhancedTransactionsApiBaseUrl(network)}/v0/addresses/${address}/transactions`,
  );
  url.searchParams.set('api-key', apiKey);
  url.searchParams.set('limit', Math.min(100, Math.max(1, limit)).toString());
  url.searchParams.set('commitment', 'confirmed');
  url.searchParams.set('sort-order', 'desc');
  url.searchParams.set('token-accounts', 'balanceChanged');
  if (cursor) {
    url.searchParams.set('before-signature', cursor);
  }

  const payload = await fetchJson(
    url.toString(),
    {
      method: 'GET',
    },
    'Wallet provider is temporarily unavailable.',
  );
  if (!Array.isArray(payload)) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  const rawTransactions = payload;
  if (rawTransactions.length === 0) {
    return {
      records: [],
      rawCount: 0,
      nextCursor: null,
    };
  }

  const metadataByMint = await fetchTokenMetadataMap(
    bindings,
    network,
    extractEnhancedTokenMints(payload),
  );
  const records = parseEnhancedTransactions(payload, network, address, metadataByMint);
  await refineEnhancedNativeSolUnknownRecords(bindings, network, address, records);
  const lastEntry = rawTransactions.at(-1);

  return {
    records,
    rawCount: rawTransactions.length,
    nextCursor:
      rawTransactions.length >= limit && isRecord(lastEntry)
        ? readTrimmedString(lastEntry.signature)
        : null,
  };
}

async function collectEnhancedRestWalletTransactions(params: {
  bindings: Bindings;
  network: Network;
  address: string;
  cursor: string | null;
  limit: number;
  maxScan: number;
  matches: (transaction: WalletTransactionRecord) => boolean;
}): Promise<WalletTransactionsResponse> {
  const { bindings, network, address, cursor, limit, maxScan, matches } = params;
  const scanStartedAt = Date.now();
  const collected: WalletTransactionRecord[] = [];
  let scannedTransactions = 0;
  let scanCursor = cursor;
  let nextCursor: string | null = null;
  let pages = 0;

  while (collected.length < limit && scannedTransactions < maxScan) {
    if (pages > 0 && Date.now() - scanStartedAt > WALLET_TRANSACTION_SCAN_BUDGET_MS) {
      break;
    }

    const pageLimit = Math.min(
      WALLET_TRANSACTION_SIGNATURE_PAGE_SIZE,
      maxScan - scannedTransactions,
    );
    const page = await fetchEnhancedRestTransactionsPage(
      bindings,
      network,
      address,
      scanCursor,
      pageLimit,
    );
    pages += 1;
    scannedTransactions += page.rawCount;

    let reachedLimit = false;
    for (const transaction of page.records) {
      if (matches(transaction)) {
        collected.push(transaction);
      }
      if (collected.length >= limit) {
        nextCursor = transaction.signature;
        reachedLimit = true;
        break;
      }
    }

    if (reachedLimit) {
      break;
    }

    nextCursor = page.nextCursor;
    if (page.rawCount === 0 || nextCursor === null) {
      break;
    }
    scanCursor = nextCursor;
  }

  return buildWalletTransactionsResponse({
    address,
    network,
    transactions: collected,
    cursor: nextCursor,
  });
}

async function fetchWalletTransactionsViaEnhancedRestApi(
  bindings: Bindings,
  network: Network,
  address: string,
  cursor: string | null,
  limit: number,
  recordTiming?: TimingRecorder,
): Promise<WalletTransactionsResponse> {
  const startedAt = Date.now();
  const response = await collectEnhancedRestWalletTransactions({
    bindings,
    network,
    address,
    cursor,
    limit,
    maxScan: Math.max(
      WALLET_TRANSACTION_SIGNATURE_PAGE_SIZE,
      Math.min(MAX_WALLET_TRANSACTION_SIGNATURE_SCAN, limit * 5),
    ),
    matches: isDisplayableWalletTransactionRecord,
  });
  recordTiming?.('etx_ms', Date.now() - startedAt);

  if (limit < WALLET_NATIVE_SOL_SUPPLEMENT_MIN_LIMIT) {
    return response;
  }

  const supplementStartedAt = Date.now();
  const supplemented = await supplementWalletHistoryWithNativeSolRpc({
    bindings,
    address,
    network,
    cursor,
    limit,
    response,
    recordTiming,
  });
  recordTiming?.('tx_sol_supplement_ms', Date.now() - supplementStartedAt);
  return supplemented;
}

async function supplementWalletHistoryWithNativeSolRpc(params: {
  bindings: Bindings;
  address: string;
  network: Network;
  cursor: string | null;
  limit: number;
  response: WalletTransactionsResponse;
  recordTiming?: TimingRecorder;
}): Promise<WalletTransactionsResponse> {
  let supplement: WalletTransactionsResponse;
  try {
    supplement = await fetchWalletTokenTransactionsViaRpc(
      params.bindings,
      params.address,
      params.network,
      SOL_MINT,
      params.cursor,
      Math.min(WALLET_NATIVE_SOL_SUPPLEMENT_LIMIT, params.limit),
      params.recordTiming,
    );
  } catch {
    return params.response;
  }

  if (supplement.transactions.length === 0) {
    return params.response;
  }

  const transactionsBySignature = new Map<string, WalletTransactionRecord>();
  for (const transaction of [...params.response.transactions, ...supplement.transactions]) {
    if (!transactionsBySignature.has(transaction.signature)) {
      transactionsBySignature.set(transaction.signature, transaction);
    }
  }

  const mergedTransactions = sortWalletTransactionsMostRecent(
    Array.from(transactionsBySignature.values()),
  );
  const visibleTransactions = mergedTransactions.slice(0, params.limit);
  const hasMore =
    mergedTransactions.length > params.limit ||
    params.response.cursor !== null ||
    supplement.cursor !== null;
  const fallbackCursor = params.response.cursor ?? supplement.cursor;
  const nextCursor = hasMore
    ? (visibleTransactions.at(-1)?.signature ?? fallbackCursor ?? null)
    : null;

  return buildWalletTransactionsResponse({
    address: params.address,
    network: params.network,
    transactions: visibleTransactions,
    cursor: nextCursor,
  });
}

interface IndexedTransactionPage {
  records: WalletTransactionRecord[];
  rawCount: number;
  // Opaque "slot:position" cursor for the next (older) page; null at the end of
  // history.
  paginationToken: string | null;
}

/**
 * Fetch and parse a single page of Helius `getTransactionsForAddress`
 * (transactionDetails: 'full'). This is the indexed replacement for
 * getSignaturesForAddress + batched getTransaction: one JSON-RPC call returns
 * complete transaction + meta objects already sorted newest-first, including a
 * wallet's associated-token-account activity via `tokenAccounts:
 * 'balanceChanged'`, so there is no per-signature fan-out. When
 * `tokenTransferMint` is set, Helius filters server-side to transactions where
 * the address participated in a transfer of that SPL mint. Native SOL is not a
 * token transfer and cannot be filtered this way, so SOL is matched locally.
 * Results are parsed with the shared raw-transaction parser.
 */
async function fetchIndexedTransactionsPage(
  bindings: Bindings,
  network: Network,
  address: string,
  paginationToken: string | null,
  limit: number,
  tokenTransferMint: string | null,
): Promise<IndexedTransactionPage> {
  const filters: Record<string, unknown> = { tokenAccounts: 'balanceChanged' };
  if (tokenTransferMint != null) {
    filters.tokenTransfer = { mint: tokenTransferMint };
  }

  const config: Record<string, unknown> = {
    transactionDetails: 'full',
    sortOrder: 'desc',
    limit: Math.min(INDEXED_TRANSACTION_PAGE_SIZE, Math.max(1, limit)),
    commitment: 'confirmed',
    encoding: 'jsonParsed',
    maxSupportedTransactionVersion: 0,
    filters,
  };
  if (paginationToken) {
    config.paginationToken = paginationToken;
  }

  const result = await heliusExclusiveRpcRequest(bindings, network, 'getTransactionsForAddress', [
    address,
    config,
  ]);
  const data = isRecord(result) && Array.isArray(result.data) ? result.data : [];
  const nextToken = isRecord(result) ? readTrimmedString(result.paginationToken) : null;

  // Resolve token metadata once per page and reuse it per record so the parser
  // does not issue a getAssetBatch per transaction.
  const metadataByMint = await fetchTokenMetadataMap(
    bindings,
    network,
    collectBatchTokenMints(data),
  );
  const records: WalletTransactionRecord[] = [];
  for (const item of data) {
    if (!isRecord(item)) {
      continue;
    }
    const transaction = isRecord(item.transaction) ? item.transaction : null;
    const signatures =
      transaction && Array.isArray(transaction.signatures) ? transaction.signatures : [];
    const signature = readTrimmedString(signatures[0]);
    if (!signature) {
      continue;
    }
    const meta = isRecord(item.meta) ? item.meta : null;
    const status: 'success' | 'failed' =
      meta != null && meta.err !== null && meta.err !== undefined ? 'failed' : 'success';
    const fallbackTimestamp = readFiniteNumber(item.blockTime) ?? 0;
    records.push(
      await buildRpcTransactionRecordFromResult(
        bindings,
        network,
        address,
        [],
        signature,
        fallbackTimestamp,
        status,
        item,
        metadataByMint,
      ),
    );
  }

  return {
    records,
    rawCount: data.length,
    paginationToken: nextToken,
  };
}

/**
 * Page-walking loop over `getTransactionsForAddress` shared by broad wallet
 * history and token-specific history. It pages backwards via `paginationToken`,
 * keeping records that pass `matches`, until at least `limit` rows are
 * collected, the scan budget (page count or wall-clock) is exhausted, or the
 * provider runs out of history. The `paginationToken` cursor is page granular
 * ("slot:position"), so pages are consumed whole and rows are never sliced off
 * mid-page (that would silently drop history). The returned cursor lets the
 * client continue on demand.
 */
async function collectIndexedWalletTransactions(params: {
  bindings: Bindings;
  network: Network;
  address: string;
  cursor: string | null;
  limit: number;
  maxScan: number;
  tokenTransferMint: string | null;
  matches: (transaction: WalletTransactionRecord) => boolean;
}): Promise<WalletTransactionsResponse> {
  const { bindings, network, address, cursor, limit, maxScan, tokenTransferMint, matches } = params;
  const scanStartedAt = Date.now();
  const collected: WalletTransactionRecord[] = [];
  let scannedTransactions = 0;
  let pageToken = cursor;
  let nextCursor: string | null = null;
  let pages = 0;

  while (collected.length < limit && scannedTransactions < maxScan) {
    if (pages > 0 && Date.now() - scanStartedAt > WALLET_TRANSACTION_SCAN_BUDGET_MS) {
      // Budget exhausted; nextCursor (from the previous page) signals more.
      break;
    }
    const pageLimit = Math.min(INDEXED_TRANSACTION_PAGE_SIZE, maxScan - scannedTransactions);
    const page = await fetchIndexedTransactionsPage(
      bindings,
      network,
      address,
      pageToken,
      pageLimit,
      tokenTransferMint,
    );
    pages += 1;
    scannedTransactions += page.rawCount;
    for (const transaction of page.records) {
      if (matches(transaction)) {
        collected.push(transaction);
      }
    }
    nextCursor = page.paginationToken;
    if (page.rawCount === 0 || nextCursor === null) {
      break;
    }
    pageToken = nextCursor;
  }

  return buildWalletTransactionsResponse({
    address,
    network,
    transactions: collected,
    cursor: nextCursor,
  });
}

async function fetchWalletTransactionsViaIndexedApi(
  bindings: Bindings,
  network: Network,
  address: string,
  cursor: string | null,
  limit: number,
  recordTiming?: TimingRecorder,
): Promise<WalletTransactionsResponse> {
  const startedAt = Date.now();
  const response = await collectIndexedWalletTransactions({
    bindings,
    network,
    address,
    cursor,
    limit,
    maxScan: Math.max(
      INDEXED_TRANSACTION_PAGE_SIZE,
      Math.min(MAX_WALLET_TRANSACTION_SIGNATURE_SCAN, limit * 5),
    ),
    tokenTransferMint: null,
    matches: isDisplayableWalletTransactionRecord,
  });
  recordTiming?.('itx_ms', Date.now() - startedAt);
  return response;
}

function inferParsedTransactionType(instructions: readonly unknown[]): string {
  for (const instruction of instructions) {
    if (!isRecord(instruction)) {
      continue;
    }

    const program = readTrimmedString(instruction.program)?.toLowerCase() ?? '';
    const parsed = isRecord(instruction.parsed) ? instruction.parsed : null;
    const parsedType = parsed ? (readTrimmedString(parsed.type)?.toLowerCase() ?? '') : '';

    if (
      program === 'system' &&
      (parsedType.includes('transfer') || parsedType === 'withdrawfromnonce')
    ) {
      return 'TRANSFER';
    }

    if (
      (program === 'spl-token' || program === 'spl-token-2022') &&
      parsedType.includes('transfer')
    ) {
      return 'TOKEN_TRANSFER';
    }

    if (program === 'stake') {
      return 'STAKE';
    }

    if (program === 'vote') {
      return 'VOTE';
    }
  }

  return 'UNKNOWN';
}

function extractParsedCounterparties(
  instructions: readonly unknown[],
  walletAddress: string,
): WalletTransactionCounterparty[] {
  const counterparties: WalletTransactionCounterparty[] = [];

  for (const instruction of instructions) {
    if (!isRecord(instruction)) {
      continue;
    }

    const program = readTrimmedString(instruction.program)?.toLowerCase() ?? '';
    const isTokenProgram = program === 'spl-token' || program === 'spl-token-2022';
    const parsed = isRecord(instruction.parsed) ? instruction.parsed : null;
    const info = parsed && isRecord(parsed.info) ? parsed.info : null;
    if (!info) {
      continue;
    }

    if (!isTokenProgram) {
      appendCounterparty(counterparties, readTrimmedString(info.source), 'sender', walletAddress);
      appendCounterparty(
        counterparties,
        readTrimmedString(info.destination),
        'recipient',
        walletAddress,
      );
    }
    appendCounterparty(
      counterparties,
      readTrimmedString(info.authority),
      'authority',
      walletAddress,
    );
  }

  return counterparties;
}

function collectRpcParsedInstructions(
  instructions: readonly unknown[],
  meta: Record<string, unknown> | null,
): unknown[] {
  const parsedInstructions = [...instructions];
  const innerInstructionGroups = meta?.innerInstructions;
  if (!Array.isArray(innerInstructionGroups)) {
    return parsedInstructions;
  }

  for (const group of innerInstructionGroups) {
    if (!isRecord(group) || !Array.isArray(group.instructions)) {
      continue;
    }

    parsedInstructions.push(...group.instructions);
  }

  return parsedInstructions;
}

function readAccountKeyAddress(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return null;
  return readTrimmedString(value.pubkey) ?? readTrimmedString(value.account) ?? null;
}

function readInstructionProgramId(
  instruction: Record<string, unknown>,
  accountKeys: readonly unknown[],
): string | null {
  const programId = readTrimmedString(instruction.programId);
  if (programId) return programId;

  const programIdIndex = readFiniteNumber(instruction.programIdIndex);
  if (programIdIndex === null || programIdIndex < 0) return null;

  return readAccountKeyAddress(accountKeys[Math.trunc(programIdIndex)]);
}

function canUseInstructionForNativeSolBalanceFallback(
  instruction: unknown,
  accountKeys: readonly unknown[],
): boolean {
  if (!isRecord(instruction)) {
    return false;
  }

  const program = readTrimmedString(instruction.program)?.toLowerCase() ?? '';
  const programId = readInstructionProgramId(instruction, accountKeys);
  if (programId === COMPUTE_BUDGET_PROGRAM_ID || MEMO_PROGRAM_IDS.has(programId ?? '')) {
    return true;
  }

  const isSystemProgram = program === 'system' || programId === SYSTEM_PROGRAM_ID;
  if (!isSystemProgram) {
    return false;
  }

  const parsed = isRecord(instruction.parsed) ? instruction.parsed : null;
  const parsedType = parsed ? (readTrimmedString(parsed.type)?.toLowerCase() ?? '') : '';
  return (
    parsedType.length === 0 || parsedType.includes('transfer') || parsedType === 'withdrawfromnonce'
  );
}

function canUseNativeSolBalanceFallback(
  instructions: readonly unknown[],
  accountKeys: readonly unknown[],
  touchesUmbra: boolean,
): boolean {
  if (touchesUmbra) {
    return false;
  }

  return instructions.every((instruction) =>
    canUseInstructionForNativeSolBalanceFallback(instruction, accountKeys),
  );
}

function extractWalletNativeSolBalanceDelta(
  result: Record<string, unknown>,
  walletAddress: string,
): bigint | null {
  const transaction = isRecord(result.transaction) ? result.transaction : null;
  const message = transaction && isRecord(transaction.message) ? transaction.message : null;
  const accountKeys = message && Array.isArray(message.accountKeys) ? message.accountKeys : [];
  const meta = isRecord(result.meta) ? result.meta : null;
  const preBalances = meta && Array.isArray(meta.preBalances) ? meta.preBalances : [];
  const postBalances = meta && Array.isArray(meta.postBalances) ? meta.postBalances : [];
  const walletIndex = accountKeys.findIndex(
    (accountKey) => readAccountKeyAddress(accountKey) === walletAddress,
  );
  if (walletIndex < 0) return null;

  const preBalance = readBigInt(preBalances[walletIndex]);
  const postBalance = readBigInt(postBalances[walletIndex]);
  if (preBalance === null || postBalance === null) return null;

  let rawDelta = postBalance - preBalance;
  const fee = meta ? readNonNegativeBigInt(meta.fee) : null;
  const feePayerAddress = readAccountKeyAddress(accountKeys[0]);
  if (rawDelta < 0n && fee !== null && feePayerAddress === walletAddress) {
    rawDelta += fee;
  }

  return rawDelta === 0n ? null : rawDelta;
}

function extractWalletNativeSolTransferDeltas(
  instructions: readonly unknown[],
  walletAddress: string,
  result: Record<string, unknown>,
  allowBalanceFallback: boolean,
): TokenBalanceDelta[] {
  let rawDelta = 0n;

  for (const instruction of instructions) {
    if (!isRecord(instruction)) {
      continue;
    }

    const program = readTrimmedString(instruction.program)?.toLowerCase() ?? '';
    const programId = readTrimmedString(instruction.programId);
    const parsed = isRecord(instruction.parsed) ? instruction.parsed : null;
    const parsedType = parsed ? (readTrimmedString(parsed.type)?.toLowerCase() ?? '') : '';
    const info = parsed && isRecord(parsed.info) ? parsed.info : null;
    const isSystemProgram = program === 'system' || programId === SYSTEM_PROGRAM_ID;
    if (!isSystemProgram || info === null) {
      continue;
    }

    const lamports = readNonNegativeBigInt(info.lamports);
    if (lamports === null || lamports === 0n) {
      continue;
    }

    if (parsedType.includes('transfer')) {
      const source = readTrimmedString(info.source);
      const destination = readTrimmedString(info.destination);
      const walletIsSource = source === walletAddress;
      const walletIsDestination = destination === walletAddress;
      if (walletIsSource) {
        rawDelta -= lamports;
      }
      if (walletIsDestination) {
        rawDelta += lamports;
      }
    } else if (parsedType === 'withdrawfromnonce') {
      const recipient = readTrimmedString(info.recipient);
      if (recipient === walletAddress) {
        rawDelta += lamports;
      }
    }
  }

  if (rawDelta === 0n) {
    if (!allowBalanceFallback) {
      return [];
    }

    // Devnet SOL funding can appear as a native balance delta without
    // a parsed system transfer instruction. Fees are removed in the
    // balance-delta helper so fee-only transactions still resolve to 0.
    const fallbackDelta = extractWalletNativeSolBalanceDelta(result, walletAddress);
    if (fallbackDelta === null) {
      return [];
    }

    rawDelta = fallbackDelta;
  }

  return [
    {
      mint: SOL_MINT,
      decimals: SOL_DECIMALS,
      rawDelta,
    },
  ];
}

function extractWalletTokenRawBalances(
  balances: unknown,
  walletAddress: string,
  walletTokenAccountAddresses: ReadonlySet<string>,
  accountKeys: readonly unknown[],
): Map<string, BalanceAccumulator> {
  const totals = new Map<string, BalanceAccumulator>();
  if (!Array.isArray(balances)) {
    return totals;
  }

  for (const entry of balances) {
    if (!isRecord(entry)) {
      continue;
    }

    const owner = readTrimmedString(entry.owner);
    const accountIndex = readFiniteNumber(entry.accountIndex);
    const accountAddress =
      accountIndex !== null && accountIndex >= 0
        ? readAccountKeyAddress(accountKeys[Math.trunc(accountIndex)])
        : null;
    const belongsToWallet =
      owner === walletAddress ||
      (owner == null && accountAddress != null && walletTokenAccountAddresses.has(accountAddress));
    if (!belongsToWallet) {
      continue;
    }

    const mint = readTrimmedString(entry.mint);
    const uiTokenAmount = isRecord(entry.uiTokenAmount) ? entry.uiTokenAmount : null;
    const amount = uiTokenAmount ? readTrimmedString(uiTokenAmount.amount) : null;
    const decimals = uiTokenAmount ? readFiniteNumber(uiTokenAmount.decimals) : null;
    if (!mint || !amount || decimals === null || !/^\d+$/.test(amount)) {
      continue;
    }

    const normalizedDecimals = Math.trunc(decimals);
    const existing = totals.get(mint);
    if (existing) {
      existing.rawAmount += BigInt(amount);
      continue;
    }

    totals.set(mint, {
      mint,
      decimals: normalizedDecimals,
      rawAmount: BigInt(amount),
    });
  }

  return totals;
}

function extractOwnerTokenRawBalances(balances: unknown): Map<string, OwnerTokenBalanceDelta> {
  const totals = new Map<string, OwnerTokenBalanceDelta>();
  if (!Array.isArray(balances)) {
    return totals;
  }

  for (const entry of balances) {
    if (!isRecord(entry)) {
      continue;
    }

    const owner = readTrimmedString(entry.owner);
    const mint = readTrimmedString(entry.mint);
    const uiTokenAmount = isRecord(entry.uiTokenAmount) ? entry.uiTokenAmount : null;
    const amount = uiTokenAmount ? readTrimmedString(uiTokenAmount.amount) : null;
    const decimals = uiTokenAmount ? readFiniteNumber(uiTokenAmount.decimals) : null;
    if (
      !owner ||
      !isValidSolanaAddress(owner) ||
      !mint ||
      !isValidSolanaAddress(mint) ||
      !amount ||
      decimals === null ||
      !/^\d+$/.test(amount)
    ) {
      continue;
    }

    const normalizedDecimals = Math.trunc(decimals);
    const key = `${owner}:${mint}`;
    const existing = totals.get(key);
    if (existing) {
      existing.rawDelta += BigInt(amount);
      continue;
    }

    totals.set(key, {
      owner,
      mint,
      decimals: normalizedDecimals,
      rawDelta: BigInt(amount),
    });
  }

  return totals;
}

function extractOwnerTokenBalanceDeltas(
  meta: Record<string, unknown> | null,
): OwnerTokenBalanceDelta[] {
  if (meta === null) {
    return [];
  }

  const preBalances = extractOwnerTokenRawBalances(meta.preTokenBalances);
  const postBalances = extractOwnerTokenRawBalances(meta.postTokenBalances);
  const keys = new Set([...preBalances.keys(), ...postBalances.keys()]);
  const deltas: OwnerTokenBalanceDelta[] = [];

  for (const key of keys) {
    const before = preBalances.get(key);
    const after = postBalances.get(key);
    const owner = after?.owner ?? before?.owner;
    const mint = after?.mint ?? before?.mint;
    if (!owner || !mint) continue;

    const decimals = after?.decimals ?? before?.decimals ?? 0;
    const rawDelta = (after?.rawDelta ?? 0n) - (before?.rawDelta ?? 0n);
    if (rawDelta === 0n) {
      continue;
    }

    deltas.push({
      owner,
      mint,
      decimals,
      rawDelta,
    });
  }

  return deltas;
}

function extractTokenBalanceCounterparties(
  meta: Record<string, unknown> | null,
  walletAddress: string,
): WalletTransactionCounterparty[] {
  const counterparties: WalletTransactionCounterparty[] = [];

  for (const delta of extractOwnerTokenBalanceDeltas(meta)) {
    if (delta.owner === walletAddress) continue;

    appendCounterparty(
      counterparties,
      delta.owner,
      delta.rawDelta < 0n ? 'sender' : 'recipient',
      walletAddress,
    );
  }

  return counterparties;
}

function extractWalletTokenBalanceDeltas(
  meta: Record<string, unknown> | null,
  walletAddress: string,
  walletTokenAccounts: readonly WalletTokenAccountAddress[] = [],
  accountKeys: readonly unknown[] = [],
): TokenBalanceDelta[] {
  if (meta === null) {
    return [];
  }

  const walletTokenAccountAddresses = new Set(
    walletTokenAccounts.map((account) => account.address),
  );
  const preBalances = extractWalletTokenRawBalances(
    meta.preTokenBalances,
    walletAddress,
    walletTokenAccountAddresses,
    accountKeys,
  );
  const postBalances = extractWalletTokenRawBalances(
    meta.postTokenBalances,
    walletAddress,
    walletTokenAccountAddresses,
    accountKeys,
  );
  const mints = new Set([...preBalances.keys(), ...postBalances.keys()]);
  const deltas: TokenBalanceDelta[] = [];

  for (const mint of mints) {
    const before = preBalances.get(mint);
    const after = postBalances.get(mint);
    const decimals = after?.decimals ?? before?.decimals ?? 0;
    const rawDelta = (after?.rawAmount ?? 0n) - (before?.rawAmount ?? 0n);
    if (rawDelta === 0n) {
      continue;
    }

    deltas.push({
      mint,
      decimals,
      rawDelta,
    });
  }

  return deltas.sort((left, right) => {
    const leftMagnitude = left.rawDelta < 0n ? -left.rawDelta : left.rawDelta;
    const rightMagnitude = right.rawDelta < 0n ? -right.rawDelta : right.rawDelta;
    if (leftMagnitude === rightMagnitude) {
      return left.mint.localeCompare(right.mint);
    }

    return leftMagnitude > rightMagnitude ? -1 : 1;
  });
}

function formatTokenDeltaAmount(delta: TokenBalanceDelta): string {
  const absoluteDelta = delta.rawDelta < 0n ? -delta.rawDelta : delta.rawDelta;
  return formatTokenAmount(absoluteDelta, delta.decimals);
}

function resolveTokenDeltaSymbol(
  delta: TokenBalanceDelta,
  metadataByMint: ReadonlyMap<string, TokenMetadata>,
): string {
  if (isNativeSolMint(delta.mint)) return 'SOL';

  const metadataSymbol = metadataByMint.get(delta.mint)?.symbol;
  return sanitizeTokenLabel(metadataSymbol, shortenAddress(delta.mint), 24);
}

function inferTypeFromTokenBalanceDeltas(deltas: readonly TokenBalanceDelta[]): string | null {
  const hasDebit = deltas.some((delta) => delta.rawDelta < 0n);
  const hasCredit = deltas.some((delta) => delta.rawDelta > 0n);
  if (hasDebit && hasCredit) return 'SWAP';
  if (hasCredit) return 'RECEIVE';
  if (hasDebit) return 'TOKEN_TRANSFER';
  return null;
}

function buildRpcTransactionTokenFields(
  network: Network,
  type: string,
  deltas: readonly TokenBalanceDelta[],
  metadataByMint: ReadonlyMap<string, TokenMetadata>,
): TransactionTokenFields {
  const primaryCredit = deltas.find((delta) => delta.rawDelta > 0n) ?? null;
  const primaryDebit = deltas.find((delta) => delta.rawDelta < 0n) ?? null;
  const primary = primaryCredit ?? primaryDebit;
  const direction =
    type === 'SWAP'
      ? null
      : primaryCredit != null
        ? 'receive'
        : primaryDebit != null
          ? 'send'
          : null;

  return resolveTransactionTokenFields(
    network,
    primary?.mint ?? null,
    primary?.decimals ?? null,
    primary?.rawDelta ?? null,
    direction,
    metadataByMint,
  );
}

function buildRpcTokenBalanceDescription(
  type: string,
  deltas: readonly TokenBalanceDelta[],
  metadataByMint: ReadonlyMap<string, TokenMetadata>,
): string | null {
  if (deltas.length === 0) {
    return null;
  }

  if (type === 'SWAP') {
    const debit = deltas.find((delta) => delta.rawDelta < 0n);
    const credit = deltas.find((delta) => delta.rawDelta > 0n);
    if (debit && credit) {
      return `Swapped ${formatTokenDeltaAmount(debit)} ${resolveTokenDeltaSymbol(
        debit,
        metadataByMint,
      )} to ${formatTokenDeltaAmount(credit)} ${resolveTokenDeltaSymbol(credit, metadataByMint)}`;
    }
  }

  const primaryDelta = deltas[0];
  if (!primaryDelta) {
    return null;
  }

  const action = primaryDelta.rawDelta > 0n ? 'Received' : 'Sent';
  return `${action} ${formatTokenDeltaAmount(primaryDelta)} ${resolveTokenDeltaSymbol(
    primaryDelta,
    metadataByMint,
  )}`;
}

function mergeCounterparties(
  primary: readonly WalletTransactionCounterparty[],
  fallback: readonly WalletTransactionCounterparty[],
): WalletTransactionCounterparty[] {
  const merged: WalletTransactionCounterparty[] = [];

  for (const counterparty of [...primary, ...fallback]) {
    if (
      merged.some(
        (entry) => entry.address === counterparty.address && entry.role === counterparty.role,
      )
    ) {
      continue;
    }

    merged.push(counterparty);
  }

  return merged;
}

async function buildRpcTransactionRecordFromResult(
  bindings: Bindings,
  network: Network,
  walletAddress: string,
  walletTokenAccounts: readonly WalletTokenAccountAddress[],
  signature: string,
  fallbackTimestamp: number,
  fallbackStatus: 'success' | 'failed',
  result: unknown,
  prefetchedTokenMetadata?: Map<string, TokenMetadata>,
): Promise<WalletTransactionRecord> {
  if (!isRecord(result)) {
    return {
      signature,
      timestamp: fallbackTimestamp,
      type: 'UNKNOWN',
      description: null,
      fee: 0,
      status: fallbackStatus,
      counterparties: [],
    };
  }

  const transaction = isRecord(result.transaction) ? result.transaction : null;
  const message = transaction && isRecord(transaction.message) ? transaction.message : null;
  const accountKeys = message && Array.isArray(message.accountKeys) ? message.accountKeys : [];
  const instructions = message && Array.isArray(message.instructions) ? message.instructions : [];
  const meta = isRecord(result.meta) ? result.meta : null;
  const parsedInstructions = collectRpcParsedInstructions(instructions, meta);
  const blockTime = readFiniteNumber(result.blockTime);
  const fee = meta ? readFiniteNumber(meta.fee) : null;
  const hasError = meta ? meta.err !== null && meta.err !== undefined : fallbackStatus === 'failed';
  const touchesUmbra = transactionTouchesUmbraProgram(result, network);

  const splTokenBalanceDeltas = extractWalletTokenBalanceDeltas(
    meta,
    walletAddress,
    walletTokenAccounts,
    accountKeys,
  );
  const nativeSolBalanceDeltas = touchesUmbra
    ? []
    : extractWalletNativeSolTransferDeltas(
        parsedInstructions,
        walletAddress,
        result,
        splTokenBalanceDeltas.length === 0 &&
          canUseNativeSolBalanceFallback(parsedInstructions, accountKeys, touchesUmbra),
      );
  const tokenBalanceDeltas = [...splTokenBalanceDeltas, ...nativeSolBalanceDeltas];
  const tokenMetadata =
    prefetchedTokenMetadata ??
    (await fetchTokenMetadataMap(
      bindings,
      network,
      tokenBalanceDeltas.map((delta) => delta.mint),
    ));
  const type =
    inferTypeFromTokenBalanceDeltas(tokenBalanceDeltas) ??
    inferParsedTransactionType(parsedInstructions);
  const baseDescription =
    buildRpcTokenBalanceDescription(type, tokenBalanceDeltas, tokenMetadata) ??
    (type === 'TRANSFER'
      ? 'Native token transfer'
      : type === 'TOKEN_TRANSFER'
        ? 'Token transfer'
        : null);
  const tokenFields = buildRpcTransactionTokenFields(
    network,
    type,
    tokenBalanceDeltas,
    tokenMetadata,
  );
  const counterparties = touchesUmbra
    ? mergeCounterparties(
        mergeCounterparties(
          extractTokenBalanceCounterparties(meta, walletAddress),
          extractParsedCounterparties(parsedInstructions, walletAddress),
        ),
        extractUmbraPoolCounterparties(result, network, walletAddress),
      )
    : mergeCounterparties(
        extractTokenBalanceCounterparties(meta, walletAddress),
        extractParsedCounterparties(parsedInstructions, walletAddress),
      );
  const umbraInstructionNames = touchesUmbra ? extractUmbraInstructionNames(result) : [];
  const umbraClassification = touchesUmbra
    ? classifyUmbraTransaction(tokenFields.direction, type, baseDescription, umbraInstructionNames)
    : null;
  const sender =
    findCounterpartyAddress(counterparties, /sender|source|from|payer|authority/) ??
    (tokenFields.direction === 'send' ? walletAddress : null);
  const recipient =
    findCounterpartyAddress(counterparties, /recipient|receiver|destination|to/) ??
    (tokenFields.direction === 'receive' ? walletAddress : null);

  return {
    signature,
    timestamp:
      blockTime !== null && blockTime > 0 ? Math.trunc(blockTime) : Math.trunc(fallbackTimestamp),
    type: umbraClassification?.type ?? type,
    description: umbraClassification?.description ?? baseDescription,
    ...tokenFields,
    fee: fee !== null && fee > 0 ? Math.trunc(fee) : 0,
    status: hasError ? 'failed' : 'success',
    sender,
    recipient,
    counterparties,
  };
}

async function fetchRpcTransactionRecord(
  bindings: Bindings,
  network: Network,
  walletAddress: string,
  walletTokenAccounts: readonly WalletTokenAccountAddress[],
  signature: string,
  fallbackTimestamp: number,
  fallbackStatus: 'success' | 'failed',
): Promise<WalletTransactionRecord> {
  const result = await heliusRpcRequest(bindings, network, 'getTransaction', [
    signature,
    {
      commitment: 'confirmed',
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 0,
    },
  ]);

  return buildRpcTransactionRecordFromResult(
    bindings,
    network,
    walletAddress,
    walletTokenAccounts,
    signature,
    fallbackTimestamp,
    fallbackStatus,
    result,
  );
}

function collectBatchTokenMints(results: readonly unknown[]): string[] {
  const mints = new Set<string>();
  for (const result of results) {
    if (!isRecord(result)) continue;
    const meta = isRecord(result.meta) ? result.meta : null;
    if (meta == null) continue;
    for (const listKey of ['preTokenBalances', 'postTokenBalances'] as const) {
      const list = meta[listKey];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!isRecord(item)) continue;
        const mint = readTrimmedString(item.mint);
        if (mint) mints.add(mint);
      }
    }
  }
  return [...mints];
}

async function fetchRpcTransactionRecordsBatch(
  bindings: Bindings,
  network: Network,
  walletAddress: string,
  walletTokenAccounts: readonly WalletTokenAccountAddress[],
  entries: readonly {
    signature: string;
    timestamp: number;
    status: 'success' | 'failed';
  }[],
): Promise<WalletTransactionRecord[]> {
  try {
    const results = await heliusRpcBatchRequest(
      bindings,
      network,
      entries.map((entry, index) => ({
        id: `getTransaction:${index}`,
        method: 'getTransaction',
        params: [
          entry.signature,
          {
            commitment: 'confirmed',
            encoding: 'jsonParsed',
            maxSupportedTransactionVersion: 0,
          },
        ],
      })),
    );

    // Resolve token metadata for the WHOLE batch in one getAssetBatch call. The
    // per-record builds below run concurrently, so without this each would miss
    // the per-mint memory cache and fire its own getAssetBatch — a fan-out of
    // dozens of concurrent RPC calls per page that exhausted subrequest/rate
    // limits (the multi-second tx_batch times and the 25s token-history hang).
    const tokenMetadata = await fetchTokenMetadataMap(
      bindings,
      network,
      collectBatchTokenMints(results),
    );

    return Promise.all(
      entries.map((entry, index) =>
        buildRpcTransactionRecordFromResult(
          bindings,
          network,
          walletAddress,
          walletTokenAccounts,
          entry.signature,
          entry.timestamp,
          entry.status,
          results[index],
          tokenMetadata,
        ),
      ),
    );
  } catch {
    return Promise.all(
      entries.map((entry) =>
        fetchRpcTransactionRecord(
          bindings,
          network,
          walletAddress,
          walletTokenAccounts,
          entry.signature,
          entry.timestamp,
          entry.status,
        ),
      ),
    );
  }
}

function parseRpcSignatureEntries(result: unknown): RpcSignatureEntry[] {
  const signatureEntries = Array.isArray(result) ? result : [];
  const entries: RpcSignatureEntry[] = [];

  for (const entry of signatureEntries) {
    if (!isRecord(entry)) continue;

    const signature = readTrimmedString(entry.signature);
    if (!signature) continue;

    const timestamp = readFiniteNumber(entry.blockTime);
    entries.push({
      signature,
      timestamp: timestamp !== null && timestamp > 0 ? timestamp : Math.floor(Date.now() / 1000),
      status: entry.err === null || entry.err === undefined ? 'success' : 'failed',
    });
  }

  return entries;
}

async function fetchRpcWalletSignaturePage(
  bindings: Bindings,
  network: Network,
  walletAddress: string,
  cursor: string | null,
  limit: number,
  tokenAccounts: WalletTokenAccountAddress[],
  timings?: WalletScanTimings,
): Promise<RpcSignaturePage> {
  const seenSources = new Set<string>();
  const sourceAddresses = [
    walletAddress,
    ...tokenAccounts.map((account) => account.address),
  ].filter((address) => {
    if (seenSources.has(address)) return false;
    seenSources.add(address);
    return true;
  });
  const requests = sourceAddresses.map((sourceAddress, index): RpcBatchRequest => {
    const config: Record<string, unknown> = {
      commitment: 'confirmed',
      limit,
    };
    if (cursor != null) {
      config.before = cursor;
    }

    return {
      id: `wallet-signatures-${index}`,
      method: 'getSignaturesForAddress',
      params: [sourceAddress, config],
    };
  });
  const signaturesStartedAt = Date.now();
  const results = await heliusRpcBatchRequest(bindings, network, requests);
  if (timings != null) timings.signaturesMs += Date.now() - signaturesStartedAt;
  const entriesBySignature = new Map<string, RpcSignatureEntry>();
  let anySourceMayHaveMore = false;

  for (const result of results) {
    const entries = parseRpcSignatureEntries(result);
    if (entries.length >= limit) {
      anySourceMayHaveMore = true;
    }

    for (const entry of entries) {
      const existing = entriesBySignature.get(entry.signature);
      if (
        existing != null &&
        (existing.timestamp > entry.timestamp ||
          (existing.timestamp === entry.timestamp && existing.signature <= entry.signature))
      ) {
        continue;
      }

      entriesBySignature.set(entry.signature, entry);
    }
  }

  const entries = Array.from(entriesBySignature.values()).sort((left, right) => {
    const timestampDiff = right.timestamp - left.timestamp;
    if (timestampDiff !== 0) return timestampDiff;
    return left.signature.localeCompare(right.signature);
  });

  return {
    entries,
    hasMore: entries.length > limit || anySourceMayHaveMore,
    tokenAccounts,
  };
}

/**
 * Fallback wallet history via raw RPC (getSignaturesForAddress + batched
 * getTransaction). Used only when the indexed Enhanced Transactions API is not
 * configured for the network or is temporarily unavailable. This path is
 * heavier (per-signature fan-out, bounded scan budget) and exists for
 * resilience and RPC-only/devnet deployments.
 */
async function fetchWalletTransactionsViaRpc(
  bindings: Bindings,
  address: string,
  network: Network,
  cursor: string | null,
  limit: number,
  recordTiming?: TimingRecorder,
): Promise<WalletTransactionsResponse> {
  const maxSignatureScan = Math.max(
    WALLET_TRANSACTION_SIGNATURE_PAGE_SIZE,
    Math.min(MAX_WALLET_TRANSACTION_SIGNATURE_SCAN, limit * 5),
  );
  const scanTimings: WalletScanTimings = {
    tokenAccountsMs: 0,
    signaturesMs: 0,
    txBatchMs: 0,
    pages: 0,
  };
  // Token accounts are stable across the whole scan, so resolve them ONCE here
  // instead of re-fetching (2 RPCs) on every signature page.
  const tokenAccountsStartedAt = Date.now();
  const tokenAccounts = await getWalletTokenAccountAddresses(bindings, address, network);
  scanTimings.tokenAccountsMs += Date.now() - tokenAccountsStartedAt;
  const scanStartedAt = Date.now();
  const filteredTransactions: WalletTransactionRecord[] = [];
  let scannedSignatures = 0;
  let scanCursor = cursor;
  let nextCursor: string | null = null;

  while (filteredTransactions.length < limit && scannedSignatures < maxSignatureScan) {
    if (scanTimings.pages > 0 && Date.now() - scanStartedAt > WALLET_TRANSACTION_SCAN_BUDGET_MS) {
      // Budget exhausted. nextCursor (set by the previous page) signals more is
      // available so the client can load older rows on demand.
      break;
    }
    const signatureLimit = Math.min(
      WALLET_TRANSACTION_SIGNATURE_PAGE_SIZE,
      maxSignatureScan - scannedSignatures,
    );
    let signaturePage: RpcSignaturePage;
    try {
      signaturePage = await fetchRpcWalletSignaturePage(
        bindings,
        network,
        address,
        scanCursor,
        signatureLimit,
        tokenAccounts,
        scanTimings,
      );
    } catch (error) {
      // Degrade gracefully: if we already have rows, return them with the
      // cursor reached so far rather than failing the whole request. Only
      // surface the error when we have nothing to show.
      if (filteredTransactions.length > 0) break;
      throw error;
    }
    const remainingDisplayableTransactions = Math.max(1, limit - filteredTransactions.length);
    const transactionBatchLimit = Math.min(
      signatureLimit,
      Math.max(MIN_WALLET_TRANSACTION_BATCH_SIZE, remainingDisplayableTransactions * 2),
    );
    const transactionRequests = signaturePage.entries.slice(0, transactionBatchLimit);
    if (transactionRequests.length === 0) {
      nextCursor = null;
      break;
    }

    scannedSignatures += transactionRequests.length;

    const transactionBatchStartedAt = Date.now();
    let parsedTransactions: WalletTransactionRecord[];
    try {
      parsedTransactions = await fetchRpcTransactionRecordsBatch(
        bindings,
        network,
        address,
        signaturePage.tokenAccounts,
        transactionRequests,
      );
    } catch (error) {
      if (filteredTransactions.length > 0) break;
      throw error;
    }
    scanTimings.txBatchMs += Date.now() - transactionBatchStartedAt;
    scanTimings.pages += 1;
    let reachedLimit = false;

    for (const transaction of parsedTransactions) {
      if (isDisplayableWalletTransactionRecord(transaction)) {
        filteredTransactions.push(transaction);
      }
      if (filteredTransactions.length >= limit) {
        nextCursor = transaction.signature;
        reachedLimit = true;
        break;
      }
    }

    if (reachedLimit) {
      break;
    }

    const lastEntry = transactionRequests.at(-1);
    const hasUnparsedSignatureEntries = transactionRequests.length < signaturePage.entries.length;
    nextCursor =
      (hasUnparsedSignatureEntries || signaturePage.hasMore) && lastEntry
        ? lastEntry.signature
        : null;
    if (nextCursor === null) {
      break;
    }
    scanCursor = nextCursor;
  }

  if (recordTiming != null) {
    recordTiming('tx_token_accounts', scanTimings.tokenAccountsMs);
    recordTiming('tx_signatures', scanTimings.signaturesMs);
    recordTiming('tx_batch', scanTimings.txBatchMs);
    recordTiming('tx_pages', scanTimings.pages);
  }

  return buildWalletTransactionsResponse({
    address,
    network,
    transactions: filteredTransactions.slice(0, limit),
    cursor: nextCursor,
  });
}

function normalizeTokenTransactionMint(mint: string): string {
  return isNativeSolMint(mint) ? SOL_MINT : mint;
}

function getTokenTransactionScanLimit(limit: number): number {
  return Math.min(100, Math.max(limit * 4, limit));
}

function getTokenTransactionMaxSignatureScan(normalizedMint: string, limit: number): number {
  if (normalizedMint === SOL_MINT) {
    return MAX_NATIVE_SOL_TOKEN_TRANSACTION_SIGNATURE_SCAN;
  }

  return Math.min(
    MAX_SPL_TOKEN_TRANSACTION_SIGNATURE_SCAN,
    Math.max(TOKEN_TRANSACTION_SIGNATURE_PAGE_SIZE, getTokenTransactionScanLimit(limit)),
  );
}

function walletTransactionMatchesMint(
  transaction: WalletTransactionRecord,
  normalizedMint: string,
): boolean {
  if (normalizedMint === SOL_MINT) {
    if (
      isNativeSolMint(transaction.tokenMint) ||
      transaction.tokenSymbol?.trim().toUpperCase() === 'SOL'
    ) {
      return true;
    }
    // A swap collapses to a single primary token, so a SOL->X swap can surface
    // with X as its primary mint. Still treat it as SOL activity when the swap
    // description references a SOL leg (descriptions are generated as
    // "Swapped <amount> SOL to <amount> X").
    return (
      transaction.type.trim().toLowerCase().includes('swap') &&
      /\bSOL\b/.test(transaction.description ?? '')
    );
  }

  return transaction.tokenMint === normalizedMint;
}

async function fetchWalletTokenTransactionsViaIndexedApi(
  bindings: Bindings,
  network: Network,
  address: string,
  mint: string,
  cursor: string | null,
  limit: number,
  recordTiming?: TimingRecorder,
): Promise<WalletTransactionsResponse> {
  const normalizedMint = normalizeTokenTransactionMint(mint);
  // SPL mints are filtered server-side via filters.tokenTransfer.mint, which
  // fills the requested limit in (usually) a single page. Native SOL is not a
  // token transfer, so it has no server-side filter and is matched locally
  // while paging.
  const tokenTransferMint = normalizedMint === SOL_MINT ? null : normalizedMint;
  // When the server already filtered by mint, only require displayability — re-
  // checking the collapsed primary token would drop swaps where the queried
  // mint is the non-primary leg. SOL (no server filter) is matched locally.
  const matches =
    tokenTransferMint != null
      ? isDisplayableWalletTransactionRecord
      : (transaction: WalletTransactionRecord): boolean =>
          walletTransactionMatchesMint(transaction, normalizedMint) &&
          isDisplayableWalletTransactionRecord(transaction);
  const startedAt = Date.now();
  const response = await collectIndexedWalletTransactions({
    bindings,
    network,
    address,
    cursor,
    limit,
    maxScan: MAX_INDEXED_TOKEN_TRANSACTION_SCAN,
    tokenTransferMint,
    matches,
  });
  recordTiming?.('ittx_ms', Date.now() - startedAt);
  return response;
}

async function fetchWalletTokenTransactionsViaEnhancedRestApi(
  bindings: Bindings,
  network: Network,
  address: string,
  mint: string,
  cursor: string | null,
  limit: number,
  recordTiming?: TimingRecorder,
): Promise<WalletTransactionsResponse> {
  const normalizedMint = normalizeTokenTransactionMint(mint);
  const startedAt = Date.now();
  const response = await collectEnhancedRestWalletTransactions({
    bindings,
    network,
    address,
    cursor,
    limit,
    maxScan: MAX_INDEXED_TOKEN_TRANSACTION_SCAN,
    matches: (transaction): boolean =>
      walletTransactionMatchesMint(transaction, normalizedMint) &&
      isDisplayableWalletTransactionRecord(transaction),
  });
  recordTiming?.('ettx_ms', Date.now() - startedAt);
  if (normalizedMint !== SOL_MINT || cursor !== null || response.cursor !== null) {
    return response;
  }

  const remainingLimit = limit - response.transactions.length;
  if (remainingLimit <= 0) {
    return response;
  }

  let supplement: WalletTransactionsResponse;
  try {
    supplement = await fetchWalletTokenTransactionsViaRpc(
      bindings,
      address,
      network,
      normalizedMint,
      null,
      limit,
      recordTiming,
    );
  } catch {
    return response;
  }
  const transactionsBySignature = new Map<string, WalletTransactionRecord>();
  for (const transaction of [...response.transactions, ...supplement.transactions]) {
    if (!transactionsBySignature.has(transaction.signature)) {
      transactionsBySignature.set(transaction.signature, transaction);
    }
  }

  return buildWalletTransactionsResponse({
    address,
    network,
    transactions: sortWalletTransactionsMostRecent(
      Array.from(transactionsBySignature.values()),
    ).slice(0, limit),
    cursor: supplement.cursor,
  });
}

async function fetchRpcWalletTokenSignaturePage(
  bindings: Bindings,
  network: Network,
  walletAddress: string,
  mint: string,
  cursor: string | null,
  signatureLimit: number,
  walletTokenAccounts: WalletTokenAccountAddress[],
  timings?: WalletScanTimings,
): Promise<RpcSignaturePage> {
  const normalizedMint = normalizeTokenTransactionMint(mint);
  const sourceAddresses =
    normalizedMint === SOL_MINT
      ? [walletAddress]
      : walletTokenAccounts
          .filter((account) => account.mint === normalizedMint)
          .map((account) => account.address);

  if (sourceAddresses.length === 0) {
    return {
      entries: [],
      hasMore: false,
      tokenAccounts: walletTokenAccounts,
    };
  }

  const requests = sourceAddresses.map((sourceAddress, index): RpcBatchRequest => {
    const config: Record<string, unknown> = {
      commitment: 'confirmed',
      limit: signatureLimit,
    };
    if (cursor != null) {
      config.before = cursor;
    }

    return {
      id: `wallet-token-signatures-${index}`,
      method: 'getSignaturesForAddress',
      params: [sourceAddress, config],
    };
  });
  const signaturesStartedAt = Date.now();
  const results = await heliusRpcBatchRequest(bindings, network, requests);
  if (timings != null) timings.signaturesMs += Date.now() - signaturesStartedAt;
  const entriesBySignature = new Map<string, RpcSignatureEntry>();
  let anySourceMayHaveMore = false;

  for (const result of results) {
    const entries = parseRpcSignatureEntries(result);
    if (entries.length >= signatureLimit) {
      anySourceMayHaveMore = true;
    }

    for (const entry of entries) {
      const existing = entriesBySignature.get(entry.signature);
      if (
        existing != null &&
        (existing.timestamp > entry.timestamp ||
          (existing.timestamp === entry.timestamp && existing.signature <= entry.signature))
      ) {
        continue;
      }

      entriesBySignature.set(entry.signature, entry);
    }
  }

  const entries = Array.from(entriesBySignature.values()).sort((left, right) => {
    const timestampDiff = right.timestamp - left.timestamp;
    if (timestampDiff !== 0) return timestampDiff;
    return left.signature.localeCompare(right.signature);
  });

  return {
    entries,
    hasMore: entries.length > signatureLimit || anySourceMayHaveMore,
    tokenAccounts: walletTokenAccounts,
  };
}

/**
 * Fallback token-specific history via raw RPC. Used only when the indexed
 * Enhanced Transactions API is unavailable for the network. For native SOL it
 * scans the wallet address and reconstructs transfers from native-balance
 * deltas (fees excluded); for SPL it scans the relevant token accounts.
 */
async function fetchWalletTokenTransactionsViaRpc(
  bindings: Bindings,
  address: string,
  network: Network,
  mint: string,
  cursor: string | null,
  limit: number,
  recordTiming?: TimingRecorder,
): Promise<WalletTransactionsResponse> {
  const normalizedMint = normalizeTokenTransactionMint(mint);
  const maxSignatureScan = getTokenTransactionMaxSignatureScan(normalizedMint, limit);
  const scanTimings: WalletScanTimings = {
    tokenAccountsMs: 0,
    signaturesMs: 0,
    txBatchMs: 0,
    pages: 0,
  };
  // Native SOL history comes from the wallet address itself and is parsed via
  // native-balance deltas, so it needs NO token-account discovery. Skipping the
  // 2 getTokenAccountsByOwner RPCs for SOL removes the most common token-detail
  // view's biggest avoidable cost and a failure point — and, because empty
  // token accounts make the native-SOL balance fallback kick in, it also
  // surfaces more SOL rows. (SPL still needs them to resolve token accounts.)
  let tokenAccounts: WalletTokenAccountAddress[] = [];
  if (normalizedMint !== SOL_MINT) {
    const tokenAccountsStartedAt = Date.now();
    tokenAccounts = await getWalletTokenAccountAddresses(bindings, address, network);
    scanTimings.tokenAccountsMs += Date.now() - tokenAccountsStartedAt;
  }
  const scanStartedAt = Date.now();
  const filteredTransactions: WalletTransactionRecord[] = [];
  let scannedSignatures = 0;
  let scanCursor = cursor;
  let nextCursor: string | null = null;

  while (filteredTransactions.length < limit && scannedSignatures < maxSignatureScan) {
    if (scanTimings.pages > 0 && Date.now() - scanStartedAt > WALLET_TRANSACTION_SCAN_BUDGET_MS) {
      // Budget exhausted; nextCursor signals more is available (load on demand).
      break;
    }
    const signatureLimit = Math.min(
      TOKEN_TRANSACTION_SIGNATURE_PAGE_SIZE,
      maxSignatureScan - scannedSignatures,
    );
    let signaturePage: RpcSignaturePage;
    try {
      signaturePage = await fetchRpcWalletTokenSignaturePage(
        bindings,
        network,
        address,
        normalizedMint,
        scanCursor,
        signatureLimit,
        tokenAccounts,
        scanTimings,
      );
    } catch (error) {
      // Degrade gracefully: return whatever matched so far rather than 503.
      if (filteredTransactions.length > 0) break;
      throw error;
    }
    const remainingDisplayableTransactions = Math.max(1, limit - filteredTransactions.length);
    const transactionBatchLimit = Math.min(
      signatureLimit,
      Math.max(MIN_WALLET_TRANSACTION_BATCH_SIZE, remainingDisplayableTransactions * 2),
    );
    const transactionRequests = signaturePage.entries.slice(0, transactionBatchLimit);
    if (transactionRequests.length === 0) {
      nextCursor = null;
      break;
    }

    scannedSignatures += transactionRequests.length;

    const transactionBatchStartedAt = Date.now();
    let parsedTransactions: WalletTransactionRecord[];
    try {
      parsedTransactions = await fetchRpcTransactionRecordsBatch(
        bindings,
        network,
        address,
        signaturePage.tokenAccounts,
        transactionRequests,
      );
    } catch (error) {
      if (filteredTransactions.length > 0) break;
      throw error;
    }
    scanTimings.txBatchMs += Date.now() - transactionBatchStartedAt;
    scanTimings.pages += 1;
    for (const transaction of parsedTransactions) {
      if (
        walletTransactionMatchesMint(transaction, normalizedMint) &&
        isDisplayableWalletTransactionRecord(transaction)
      ) {
        filteredTransactions.push(transaction);
      }
      if (filteredTransactions.length >= limit) break;
    }

    const lastEntry = transactionRequests.at(-1);
    const hasUnparsedSignatureEntries = transactionRequests.length < signaturePage.entries.length;
    nextCursor =
      (hasUnparsedSignatureEntries || signaturePage.hasMore) && lastEntry
        ? lastEntry.signature
        : null;
    if (nextCursor === null) break;
    scanCursor = nextCursor;
  }

  if (recordTiming != null) {
    recordTiming('ttx_token_accounts', scanTimings.tokenAccountsMs);
    recordTiming('ttx_signatures', scanTimings.signaturesMs);
    recordTiming('ttx_batch', scanTimings.txBatchMs);
    recordTiming('ttx_pages', scanTimings.pages);
  }

  return buildWalletTransactionsResponse({
    address,
    network,
    transactions: filteredTransactions.slice(0, limit),
    cursor: nextCursor,
  });
}

async function getWalletBalance(
  bindings: Bindings,
  request: WalletBalanceRequest,
): Promise<WalletBalanceResponse> {
  const useCache = request.useCache ?? true;
  const cacheKey = createNetworkCacheKey(request.network, 'wallet-balance', [request.address]);

  const resolver = async () => {
    if (request.network === 'mainnet') {
      try {
        return await fetchWalletBalanceViaWalletApi(bindings, request.address);
      } catch (error) {
        if (error instanceof AppError && error.status === 503) {
          return fetchWalletBalanceViaRpc(bindings, request.address, request.network);
        }

        throw error;
      }
    }

    return fetchWalletBalanceViaRpc(bindings, request.address, request.network);
  };

  return useCache
    ? memoryCache.getOrSet(cacheKey, WALLET_BALANCE_CACHE_TTL_MS, () =>
        getOrSetSharedJsonCache({
          bindings,
          namespace: 'wallet-balance-v1',
          key: cacheKey,
          ttlMs: WALLET_BALANCE_CACHE_TTL_MS,
          isValid: isWalletBalanceResponse,
          resolver,
          recordTiming: request.recordTiming,
          metricLabel: 'bal',
        }),
      )
    : resolver();
}

async function getWalletTransactions(
  bindings: Bindings,
  request: WalletTransactionsRequest,
): Promise<WalletTransactionsResponse> {
  const normalizedLimit = Math.min(100, Math.max(1, request.limit ?? DEFAULT_TRANSACTION_LIMIT));
  const normalizedCursor = request.cursor?.trim() || null;
  const useCache = request.useCache ?? true;
  const cacheKey = createNetworkCacheKey(request.network, 'wallet-transactions-v7-sol-supplement', [
    request.address,
    normalizedCursor ?? 'first-page',
    normalizedLimit,
  ]);

  const resolver = async () => {
    // Prefer paid indexed getTransactionsForAddress on both networks. If that
    // plan-gated method is unavailable, use Helius enhanced REST before the raw
    // RPC signature scan; REST is still indexed and avoids per-signature
    // getTransaction fan-out.
    if (hasHeliusApiKey(bindings, request.network)) {
      try {
        return await fetchWalletTransactionsViaIndexedApi(
          bindings,
          request.network,
          request.address,
          normalizedCursor,
          normalizedLimit,
          request.recordTiming,
        );
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 503) {
          throw error;
        }
        request.recordTiming?.('itx_fallback_503', 1);
        writeOperationalLog('warn', {
          event: 'wallet_transactions_indexed_fallback',
          network: request.network,
          details: describeIndexedFallbackCause(error),
        });
      }

      try {
        return await fetchWalletTransactionsViaEnhancedRestApi(
          bindings,
          request.network,
          request.address,
          normalizedCursor,
          normalizedLimit,
          request.recordTiming,
        );
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 503) {
          throw error;
        }
        request.recordTiming?.('etx_fallback_503', 1);
        writeOperationalLog('warn', {
          event: 'wallet_transactions_enhanced_rest_fallback',
          network: request.network,
          details: describeIndexedFallbackCause(error),
        });
      }
    }

    return fetchWalletTransactionsViaRpc(
      bindings,
      request.address,
      request.network,
      normalizedCursor,
      normalizedLimit,
      request.recordTiming,
    );
  };

  return useCache
    ? memoryCache.getOrSet(cacheKey, WALLET_TRANSACTIONS_CACHE_TTL_MS, () =>
        getOrSetSharedJsonCache({
          bindings,
          namespace: 'wallet-transactions-v7-sol-supplement',
          key: cacheKey,
          ttlMs: WALLET_TRANSACTIONS_CACHE_TTL_MS,
          isValid: isWalletTransactionsResponse,
          resolver,
          recordTiming: request.recordTiming,
          metricLabel: 'tx',
        }),
      )
    : resolver();
}

async function getWalletTokenTransactions(
  bindings: Bindings,
  request: WalletTokenTransactionsRequest,
): Promise<WalletTransactionsResponse> {
  const normalizedLimit = Math.min(50, Math.max(1, request.limit ?? DEFAULT_TRANSACTION_LIMIT));
  const normalizedCursor = request.cursor?.trim() || null;
  const normalizedMint = normalizeTokenTransactionMint(request.mint.trim());
  const useCache = request.useCache ?? true;
  const cacheKey = createNetworkCacheKey(request.network, 'wallet-token-transactions-v4-indexed', [
    request.address,
    normalizedMint,
    normalizedCursor ?? 'first-page',
    normalizedLimit,
  ]);

  const resolver = async () => {
    // Prefer paid indexed getTransactionsForAddress on both networks: SPL mints
    // are filtered server-side there, native SOL is matched locally while
    // paging. If unavailable, use enhanced REST before falling back to the raw
    // RPC scan.
    if (hasHeliusApiKey(bindings, request.network)) {
      try {
        return await fetchWalletTokenTransactionsViaIndexedApi(
          bindings,
          request.network,
          request.address,
          normalizedMint,
          normalizedCursor,
          normalizedLimit,
          request.recordTiming,
        );
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 503) {
          throw error;
        }
        request.recordTiming?.('ittx_fallback_503', 1);
        writeOperationalLog('warn', {
          event: 'wallet_token_transactions_indexed_fallback',
          network: request.network,
          details: {
            mint: normalizedMint === SOL_MINT ? 'native-sol' : 'spl',
            ...describeIndexedFallbackCause(error),
          },
        });
      }

      try {
        return await fetchWalletTokenTransactionsViaEnhancedRestApi(
          bindings,
          request.network,
          request.address,
          normalizedMint,
          normalizedCursor,
          normalizedLimit,
          request.recordTiming,
        );
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 503) {
          throw error;
        }
        request.recordTiming?.('ettx_fallback_503', 1);
        writeOperationalLog('warn', {
          event: 'wallet_token_transactions_enhanced_rest_fallback',
          network: request.network,
          details: {
            mint: normalizedMint === SOL_MINT ? 'native-sol' : 'spl',
            ...describeIndexedFallbackCause(error),
          },
        });
      }
    }

    return fetchWalletTokenTransactionsViaRpc(
      bindings,
      request.address,
      request.network,
      normalizedMint,
      normalizedCursor,
      normalizedLimit,
      request.recordTiming,
    );
  };

  return useCache
    ? memoryCache.getOrSet(cacheKey, WALLET_TRANSACTIONS_CACHE_TTL_MS, () =>
        getOrSetSharedJsonCache({
          bindings,
          namespace: 'wallet-token-transactions-v4-indexed',
          key: cacheKey,
          ttlMs: WALLET_TRANSACTIONS_CACHE_TTL_MS,
          isValid: isWalletTransactionsResponse,
          resolver,
          recordTiming: request.recordTiming,
          metricLabel: 'ttx',
        }),
      )
    : resolver();
}

/**
 * Synchronous check of whether wallet-activity streaming is configured for a
 * network. Unlike getStreamCapabilities() this does NOT touch the RPC (no
 * getSlot), so the SSE route can gate its 503 instantly and keep getSlot off
 * the time-to-first-byte path. Live RPC reachability is reported as an event
 * after the stream opens.
 */
function isWalletActivityStreamConfigured(network: Network): boolean {
  return STREAM_DEFAULTS[network].walletActivity;
}

async function isWalletActivityLive(bindings: Bindings, network: Network): Promise<boolean> {
  if (!STREAM_DEFAULTS[network].walletActivity) {
    return false;
  }

  try {
    const result = await heliusRpcRequest(bindings, network, 'getSlot', [
      { commitment: 'confirmed' },
    ]);
    const slot = readFiniteNumber(result);
    return slot !== null && slot >= 0;
  } catch {
    return false;
  }
}

async function getStreamCapabilities(
  bindings: Bindings,
  network: Network,
): Promise<StreamCapabilitiesResponse> {
  const cacheKey = createNetworkCacheKey(network, 'stream-capabilities', ['wallet-activity']);

  return memoryCache.getOrSet(cacheKey, STREAM_CAPABILITY_CACHE_TTL_MS, async () => ({
    network,
    capabilities: {
      walletActivity: await isWalletActivityLive(bindings, network),
    },
  }));
}

function extractTransactionExecutionError(payload: unknown): string | null {
  if (
    !isRecord(payload) ||
    !isRecord(payload.meta) ||
    payload.meta.err === null ||
    payload.meta.err === undefined
  ) {
    return null;
  }

  const logMessages = Array.isArray(payload.meta.logMessages)
    ? payload.meta.logMessages.filter((entry): entry is string => typeof entry === 'string')
    : [];

  const primaryLog =
    logMessages.find((entry) => /insufficient lamports/i.test(entry)) ??
    logMessages.find((entry) => /failed:/i.test(entry)) ??
    logMessages.find((entry) => /custom program error/i.test(entry));

  if (primaryLog) {
    return sanitizeText(primaryLog, 200);
  }

  return sanitizeText(JSON.stringify(payload.meta.err), 200);
}

async function getTransactionExecutionStatus(
  bindings: Bindings,
  request: TransactionExecutionStatusRequest,
): Promise<TransactionExecutionStatusResponse> {
  const attempts = request.attempts ?? 6;
  const delayMs = request.delayMs ?? 500;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await heliusRpcRequest(bindings, request.network, 'getTransaction', [
      request.signature,
      {
        commitment: 'confirmed',
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
      },
    ]);

    if (result === null) {
      if (attempt < attempts - 1) {
        await sleep(delayMs);
      }
      continue;
    }

    const error = extractTransactionExecutionError(result);
    return {
      success: error === null,
      error,
    };
  }

  return {
    success: null,
    error: null,
  };
}

function setHeliusFetchImplementation(implementation: HeliusFetchImplementation): void {
  heliusFetchImplementation = implementation;
}

function resetHeliusFetchImplementation(): void {
  heliusFetchImplementation = (input, init) => fetch(input, init);
}

export {
  DEFAULT_STREAM_ACTIVITY_LIMIT,
  DEFAULT_STREAM_POLL_INTERVAL_MS,
  DEFAULT_STREAM_WEBSOCKET_FALLBACK_POLL_INTERVAL_MS,
  STREAM_CAPABILITY_CACHE_TTL_MS,
  STREAM_DEFAULTS,
  WALLET_BALANCE_CACHE_TTL_MS,
  WALLET_TRANSACTIONS_CACHE_TTL_MS,
  broadcastRawTransaction,
  getFeeForMessage,
  getLatestBlockhash,
  getMinimumBalanceForRentExemption,
  getRpcAccounts,
  getRpcEpochInfo,
  getRpcSignatureStatuses,
  getRpcSignaturesForAddress,
  getRpcSlot,
  getRpcTokenLargestAccounts,
  getTransactionExecutionStatus,
  getStreamCapabilities,
  isWalletActivityStreamConfigured,
  getWalletTokenAccountAddresses,
  getWalletLamports,
  getWalletMintRawBalance,
  getWalletBalance,
  getWalletTokenTransactions,
  getWalletTransactions,
  resetHeliusFetchImplementation,
  setHeliusFetchImplementation,
  walletHasMintAccount,
  type RawTransactionBroadcastRequest,
  type RawTransactionBroadcastResponse,
  type HeliusFetchImplementation,
  type FeeForMessageRequest,
  type MinimumRentExemptionRequest,
  type RpcAccountInfo,
  type RpcAccountsRequest,
  type RpcAccountsResponse,
  type RpcEpochInfoResponse,
  type RpcSignatureForAddressRecord,
  type RpcSignatureStatusRecord,
  type RpcSignatureStatusesRequest,
  type RpcSignatureStatusesResponse,
  type RpcSignaturesForAddressRequest,
  type RpcSignaturesForAddressResponse,
  type RpcSlotResponse,
  type RpcTokenLargestAccount,
  type RpcTokenLargestAccountsRequest,
  type RpcTokenLargestAccountsResponse,
  type StreamCapabilities,
  type StreamCapabilitiesResponse,
  type WalletLamportsRequest,
  type WalletMintRawBalanceRequest,
  type WalletBalanceRequest,
  type WalletBalanceResponse,
  type WalletBalanceToken,
  type WalletTransactionCounterparty,
  type WalletTransactionRecord,
  type WalletTokenAccountAddress,
  type WalletTokenTransactionsRequest,
  type WalletTransactionsRequest,
  type WalletTransactionsResponse,
};
