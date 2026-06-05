import { AppError } from './errors.js';
import { createNetworkCacheKey, memoryCache } from './cache.js';
import { getRpcHttpUrlCandidates } from './solana-rpc-providers.js';
import type { Bindings, Network } from './types.js';
import { isRecord, isValidSolanaAddress } from './validation.js';

const MAINNET_WALLET_API_BASE_URL = 'https://api.helius.xyz';
const MAINNET_ENHANCED_API_BASE_URL = 'https://api-mainnet.helius-rpc.com';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const HELIUS_NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111111';
const SOL_DECIMALS = 9;
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
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
}

interface WalletTransactionsResponse {
  address: string;
  network: Network;
  transactions: WalletTransactionRecord[];
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

interface WalletBalanceRequest {
  address: string;
  network: Network;
  useCache?: boolean;
}

interface WalletTransactionsRequest {
  address: string;
  network: Network;
  cursor?: string | null;
  limit?: number;
  useCache?: boolean;
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

type RpcRequestParams = ReadonlyArray<unknown> | Readonly<Record<string, unknown>>;

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

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
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

function sanitizeTransactionType(value: string | null | undefined): string {
  if (!value) {
    return 'UNKNOWN';
  }

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_');
  return normalized.length > 0 ? normalized.slice(0, 64) : 'UNKNOWN';
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

function collectUmbraInstructionAccounts(value: unknown, programId: string, addresses: Set<string>, depth = 0): void {
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
  const instructionTouchesUmbra = instructionProgramId === programId || (
    Array.isArray(value.accounts) && containsStringValue(value.accounts, programId)
  );
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
        name.includes('register') ||
        name.includes('registration') ||
        name.includes('setup'),
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

async function fetchJson(url: string, init: RequestInit, errorMessage: string): Promise<unknown> {
  let response: Response;
  try {
    response = await heliusFetchImplementation(url, init);
  } catch (error) {
    throw toUpstreamUnavailable(null, errorMessage, error);
  }

  if (!response.ok) {
    throw toUpstreamUnavailable(response, errorMessage);
  }

  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw toUpstreamUnavailable(response, errorMessage, error);
  }
}

async function heliusRpcRequest(
  bindings: Bindings,
  network: Network,
  method: string,
  params: RpcRequestParams,
): Promise<unknown> {
  const candidates = getRpcHttpUrlCandidates(bindings, network);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
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
      );

      if (!isRecord(payload)) {
        lastError = new Error('RPC provider returned a malformed payload.');
        continue;
      }

      if ('error' in payload && payload.error !== null && payload.error !== undefined) {
        lastError = payload.error;
        continue;
      }

      return payload.result;
    } catch (error) {
      lastError = error;
    }
  }

  throw toUpstreamUnavailable(
    null,
    'Wallet provider is temporarily unavailable.',
    lastError ?? undefined,
  );
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
  const result = await heliusRpcRequest(bindings, request.network, 'getMultipleAccounts', [
    request.addresses,
    {
      commitment: 'confirmed',
      encoding: 'base64',
    },
  ]);

  const values = isRecord(result) && Array.isArray(result.value) ? result.value : null;
  if (!values) {
    throw toUpstreamUnavailable(null, 'Wallet provider is temporarily unavailable.');
  }

  return {
    network: request.network,
    accounts: request.addresses.map((address, index) => parseRpcAccount(address, values[index])),
    fetchedAt: Date.now(),
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

  return Array.from(mints);
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

function findCounterpartyAddress(
  counterparties: readonly WalletTransactionCounterparty[],
  rolePattern: RegExp,
): string | null {
  return (
    counterparties.find((counterparty) => rolePattern.test(counterparty.role))?.address ?? null
  );
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
    const formattedAmount = `${formatTokenAmount(decimalStringToScaledInteger(amount, 9), 9)} ${symbol}`;
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
    const providerType = sanitizeTransactionType(readString(entry.type));
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

async function fetchWalletTransactionsViaEnhancedApi(
  bindings: Bindings,
  address: string,
  cursor: string | null,
  limit: number,
): Promise<WalletTransactionsResponse> {
  const apiKey = getHeliusApiKey(bindings, 'mainnet');
  const url = new URL(`${MAINNET_ENHANCED_API_BASE_URL}/v0/addresses/${address}/transactions`);
  url.searchParams.set('api-key', apiKey);
  url.searchParams.set('limit', limit.toString());
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

  const tokenMetadata = await fetchTokenMetadataMap(
    bindings,
    'mainnet',
    extractEnhancedTokenMints(payload),
  );
  const transactions = parseEnhancedTransactions(payload, 'mainnet', address, tokenMetadata);
  const rawTransactions = Array.isArray(payload) ? payload : [];
  const lastEntry = rawTransactions.at(-1);
  const nextCursor =
    rawTransactions.length === limit && isRecord(lastEntry)
      ? readTrimmedString(lastEntry.signature)
      : null;

  return {
    address,
    network: 'mainnet',
    transactions,
    cursor: nextCursor,
    fetchedAt: Date.now(),
  };
}

function inferParsedTransactionType(instructions: readonly unknown[]): string {
  for (const instruction of instructions) {
    if (!isRecord(instruction)) {
      continue;
    }

    const program = readTrimmedString(instruction.program)?.toLowerCase() ?? '';
    const parsed = isRecord(instruction.parsed) ? instruction.parsed : null;
    const parsedType = parsed ? (readTrimmedString(parsed.type)?.toLowerCase() ?? '') : '';

    if (program === 'system' && parsedType.includes('transfer')) {
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

function extractWalletNativeSolTransferDeltas(
  instructions: readonly unknown[],
  walletAddress: string,
): TokenBalanceDelta[] {
  let rawDelta = 0n;

  for (const instruction of instructions) {
    if (!isRecord(instruction)) {
      continue;
    }

    const program = readTrimmedString(instruction.program)?.toLowerCase() ?? '';
    const parsed = isRecord(instruction.parsed) ? instruction.parsed : null;
    const parsedType = parsed ? (readTrimmedString(parsed.type)?.toLowerCase() ?? '') : '';
    const info = parsed && isRecord(parsed.info) ? parsed.info : null;
    if (program !== 'system' || !parsedType.includes('transfer') || info === null) {
      continue;
    }

    const lamports = readNonNegativeBigInt(info.lamports);
    if (lamports === null || lamports === 0n) {
      continue;
    }

    if (readTrimmedString(info.source) === walletAddress) {
      rawDelta -= lamports;
    }
    if (readTrimmedString(info.destination) === walletAddress) {
      rawDelta += lamports;
    }
  }

  if (rawDelta === 0n) {
    return [];
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
    if (owner && owner !== walletAddress) {
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
): TokenBalanceDelta[] {
  if (meta === null) {
    return [];
  }

  const preBalances = extractWalletTokenRawBalances(meta.preTokenBalances, walletAddress);
  const postBalances = extractWalletTokenRawBalances(meta.postTokenBalances, walletAddress);
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

async function fetchRpcTransactionRecord(
  bindings: Bindings,
  network: Network,
  walletAddress: string,
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
  const instructions = message && Array.isArray(message.instructions) ? message.instructions : [];
  const meta = isRecord(result.meta) ? result.meta : null;
  const parsedInstructions = collectRpcParsedInstructions(instructions, meta);
  const blockTime = readFiniteNumber(result.blockTime);
  const fee = meta ? readFiniteNumber(meta.fee) : null;
  const hasError = meta ? meta.err !== null && meta.err !== undefined : fallbackStatus === 'failed';

  const tokenBalanceDeltas = [
    ...extractWalletTokenBalanceDeltas(meta, walletAddress),
    ...extractWalletNativeSolTransferDeltas(parsedInstructions, walletAddress),
  ];
  const tokenMetadata = await fetchTokenMetadataMap(
    bindings,
    network,
    tokenBalanceDeltas.map((delta) => delta.mint),
  );
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
  const touchesUmbra = transactionTouchesUmbraProgram(result, network);
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

async function fetchWalletTransactionsViaRpc(
  bindings: Bindings,
  address: string,
  network: Network,
  cursor: string | null,
  limit: number,
): Promise<WalletTransactionsResponse> {
  const signaturesResult = await heliusRpcRequest(bindings, network, 'getSignaturesForAddress', [
    address,
    {
      commitment: 'confirmed',
      limit,
      ...(cursor ? { before: cursor } : {}),
    },
  ]);

  const signatureEntries = Array.isArray(signaturesResult) ? signaturesResult : [];
  const validSignatures = signatureEntries.filter(isRecord);

  const transactions = await Promise.all(
    validSignatures.map(async (entry) => {
      const signature = readTrimmedString(entry.signature);
      if (!signature) {
        return null;
      }

      const timestamp = readFiniteNumber(entry.blockTime);
      const status: 'success' | 'failed' =
        entry.err === null || entry.err === undefined ? 'success' : 'failed';

      return fetchRpcTransactionRecord(
        bindings,
        network,
        address,
        signature,
        timestamp !== null && timestamp > 0 ? timestamp : Math.floor(Date.now() / 1000),
        status,
      );
    }),
  );

  const filteredTransactions = transactions.filter(
    (entry): entry is WalletTransactionRecord => entry !== null,
  );

  const lastEntry = validSignatures.at(-1);
  const nextCursor =
    validSignatures.length === limit && lastEntry ? readTrimmedString(lastEntry.signature) : null;

  return {
    address,
    network,
    transactions: filteredTransactions,
    cursor: nextCursor,
    fetchedAt: Date.now(),
  };
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
    ? memoryCache.getOrSet(cacheKey, WALLET_BALANCE_CACHE_TTL_MS, resolver)
    : resolver();
}

async function getWalletTransactions(
  bindings: Bindings,
  request: WalletTransactionsRequest,
): Promise<WalletTransactionsResponse> {
  const normalizedLimit = Math.min(100, Math.max(1, request.limit ?? DEFAULT_TRANSACTION_LIMIT));
  const normalizedCursor = request.cursor?.trim() || null;
  const useCache = request.useCache ?? true;
  const cacheKey = createNetworkCacheKey(request.network, 'wallet-transactions', [
    request.address,
    normalizedCursor ?? 'first-page',
    normalizedLimit,
  ]);

  const resolver = async () => {
    if (request.network === 'mainnet') {
      try {
        return await fetchWalletTransactionsViaEnhancedApi(
          bindings,
          request.address,
          normalizedCursor,
          normalizedLimit,
        );
      } catch (error) {
        if (error instanceof AppError && error.status === 503) {
          return fetchWalletTransactionsViaRpc(
            bindings,
            request.address,
            request.network,
            normalizedCursor,
            normalizedLimit,
          );
        }

        throw error;
      }
    }

    return fetchWalletTransactionsViaRpc(
      bindings,
      request.address,
      request.network,
      normalizedCursor,
      normalizedLimit,
    );
  };

  return useCache
    ? memoryCache.getOrSet(cacheKey, WALLET_TRANSACTIONS_CACHE_TTL_MS, resolver)
    : resolver();
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
  getWalletTokenAccountAddresses,
  getWalletLamports,
  getWalletMintRawBalance,
  getWalletBalance,
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
  type WalletTransactionsRequest,
  type WalletTransactionsResponse,
};
