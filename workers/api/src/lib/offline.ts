import { Buffer } from 'buffer';
import {
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { AppError } from './errors.js';
import {
  getLatestBlockhash,
  getMinimumBalanceForRentExemption,
  getRpcAccounts,
  getWalletLamports,
  type RpcAccountInfo,
} from './helius.js';
import { runKvPipeline } from './provider-utils.js';
import { canonicalJsonStringify, isRecord, isValidSolanaAddress } from './validation.js';
import type { Bindings, Network } from './types.js';

const OFFLINE_SLOT_MIN_COUNT = 10;
const OFFLINE_SLOT_MAX_COUNT = 50;
const OFFLINE_RENT_ESTIMATE_TTL_MS = 60_000;
const OFFLINE_IDEMPOTENCY_TTL_SEC = 24 * 60 * 60;
const OFFLINE_NONCE_POOL_SET_PREFIX = 'offline:nonce-pool:v1';
const OFFLINE_NONCE_RECORD_PREFIX = 'offline:nonce-account:v1';
const OFFLINE_IDEMPOTENCY_PREFIX = 'offline:idempotency:v1';
const OFFLINE_NONCE_POOL_LOCK_PREFIX = 'offline:nonce-pool-lock:v1';
const OFFLINE_NONCE_POOL_LOCK_TTL_SEC = 30;
const LAMPORTS_PER_SOL = 1_000_000_000n;
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MAINNET_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

type StablecoinSymbol = 'USDC' | 'USDT';
type NonceSlotState = 'ready' | 'missing' | 'stale' | 'invalid_authority';

interface SupportedStablecoin {
  symbol: StablecoinSymbol;
  name: string;
  mint: string | null;
  decimals: number;
  programId: string;
  enabled: boolean;
  reason: string | null;
}

interface RentEstimateRequest {
  slotCount: number;
  network: Network;
  walletAddress?: string;
}

interface RentEstimateResponse {
  network: Network;
  slotCount: number;
  lamportsPerNonceAccount: string;
  totalLamports: string;
  estimatedSol: string;
  walletLamports: string | null;
  affordableSlotCount: number | null;
  expiresAt: number;
}

interface PrepareNoncePoolRequest {
  walletAddress: string;
  nonceAuthority: string;
  nonceAccounts: string[];
  network: Network;
  idempotencyKey: string;
}

interface PreparedNonceTransaction {
  nonceAccount: string;
  transactionBase64: string;
}

interface PrepareNoncePoolResponse {
  network: Network;
  unsignedTransactions: PreparedNonceTransaction[];
  rentLamports: string;
}

interface AdvanceNoncePoolRequest {
  walletAddress: string;
  nonceAccount: string;
  network: Network;
  idempotencyKey: string;
}

interface AdvanceNoncePoolResponse {
  network: Network;
  nonceAccount: string;
  nonceValue: string;
  authority: string;
  transactionBase64: string;
}

interface NoncePoolStatusRequest {
  walletAddress: string;
  network: Network;
  targetSlotCount?: number;
}

interface NoncePoolSlotStatus {
  nonceAccount: string;
  state: NonceSlotState;
  nonceValue: string | null;
  authority: string | null;
  lamports: string | null;
  rentExempt: boolean | null;
  checkedAt: number;
}

interface NoncePoolStatusResponse {
  network: Network;
  walletAddress: string;
  targetSlotCount: number;
  counts: {
    ready: number;
    locked: number;
    settling: number;
    stale: number;
    missing: number;
    invalidAuthority: number;
    needsRefill: number;
  };
  slots: NoncePoolSlotStatus[];
  fetchedAt: number;
}

interface TokenContextRequest {
  mint: string;
  sender: string;
  recipient: string;
  network: Network;
}

interface TokenAccountContext {
  associatedTokenAddress: string;
  accountExists: boolean;
}

interface TokenContextResponse {
  network: Network;
  owner: string;
  sender: string;
  recipient: string;
  mint: string;
  symbol: StablecoinSymbol;
  name: string;
  decimals: number;
  programId: string;
  associatedTokenAddress: string;
  accountExists: boolean;
  senderTokenAccount: TokenAccountContext;
  recipientTokenAccount: TokenAccountContext;
  supportedStablecoins: SupportedStablecoin[];
  fetchedAt: number;
}

interface StoredIdempotencyRecord<T = unknown> {
  requestHash: string;
  response: T;
  createdAt: number;
  expiresAt: number;
}

interface OfflineNonceStore {
  getIdempotencyRecord(storageKey: string): Promise<StoredIdempotencyRecord | null>;
  storeIdempotencyRecord(
    storageKey: string,
    record: StoredIdempotencyRecord,
    ttlSec: number,
  ): Promise<boolean>;
  acquireNoncePoolLock(walletAddress: string, network: Network): Promise<string | null>;
  releaseNoncePoolLock(walletAddress: string, network: Network, lockToken: string): Promise<void>;
  addNonceAccounts(walletAddress: string, network: Network, nonceAccounts: string[]): Promise<void>;
  removeNonceAccounts(
    walletAddress: string,
    network: Network,
    nonceAccounts: string[],
  ): Promise<void>;
  listNonceAccounts(walletAddress: string, network: Network): Promise<string[]>;
}

type OfflineNonceStoreFactory = (bindings: Bindings) => OfflineNonceStore;

let offlineNonceStoreFactory: OfflineNonceStoreFactory = createOfflineNonceStore;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

function clampSlotCount(value: number): number {
  if (!Number.isFinite(value)) {
    return OFFLINE_SLOT_MIN_COUNT;
  }

  return Math.min(OFFLINE_SLOT_MAX_COUNT, Math.max(OFFLINE_SLOT_MIN_COUNT, Math.trunc(value)));
}

function formatLamportsAsSol(value: bigint): string {
  const whole = value / LAMPORTS_PER_SOL;
  const fractional = (value % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  return fractional.length > 0 ? `${whole}.${fractional}` : whole.toString();
}

function toSafeLamportsNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Rent estimate is outside the supported transaction range.',
      retryable: true,
    });
  }

  return Number(value);
}

function assertSolanaAddress(value: string, message: string): void {
  if (!isValidSolanaAddress(value)) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message,
    });
  }
}

function uniqueAddresses(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()))).filter(
    (value) => value.length > 0,
  );
}

function buildNoncePoolSetKey(walletAddress: string, network: Network): string {
  return `${OFFLINE_NONCE_POOL_SET_PREFIX}:${network}:${walletAddress}`;
}

function buildNoncePoolLockKey(walletAddress: string, network: Network): string {
  return `${OFFLINE_NONCE_POOL_LOCK_PREFIX}:${network}:${walletAddress}`;
}

function buildNonceAccountRecordKey(
  walletAddress: string,
  network: Network,
  nonceAccount: string,
): string {
  return `${OFFLINE_NONCE_RECORD_PREFIX}:${network}:${walletAddress}:${nonceAccount}`;
}

function buildIdempotencyStorageKey(
  walletAddress: string,
  network: Network,
  action: string,
  idempotencyHash: string,
): string {
  return `${OFFLINE_IDEMPOTENCY_PREFIX}:${network}:${walletAddress}:${action}:${idempotencyHash}`;
}

function parseStoredIdempotencyRecord(value: unknown): StoredIdempotencyRecord | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.requestHash !== 'string' || !('response' in parsed)) {
    return null;
  }

  const createdAt = typeof parsed.createdAt === 'number' ? parsed.createdAt : 0;
  const expiresAt = typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0;

  return {
    requestHash: parsed.requestHash,
    response: parsed.response,
    createdAt,
    expiresAt,
  };
}

function createOfflineNonceStore(bindings: Bindings): OfflineNonceStore {
  return {
    async getIdempotencyRecord(storageKey) {
      const [record] = await runKvPipeline(
        bindings,
        [['GET', storageKey]],
        'Offline nonce idempotency storage is unavailable.',
      );
      return parseStoredIdempotencyRecord(record);
    },
    async storeIdempotencyRecord(storageKey, record, ttlSec) {
      const [result] = await runKvPipeline(
        bindings,
        [['SET', storageKey, JSON.stringify(record), 'NX', 'EX', ttlSec]],
        'Offline nonce idempotency storage is unavailable.',
      );
      return result === 'OK';
    },
    async acquireNoncePoolLock(walletAddress, network) {
      const lockToken = crypto.randomUUID();
      const [result] = await runKvPipeline(
        bindings,
        [
          [
            'SET',
            buildNoncePoolLockKey(walletAddress, network),
            lockToken,
            'NX',
            'EX',
            OFFLINE_NONCE_POOL_LOCK_TTL_SEC,
          ],
        ],
        'Offline nonce pool storage is unavailable.',
      );

      return result === 'OK' ? lockToken : null;
    },
    async releaseNoncePoolLock(walletAddress, network, lockToken) {
      const lockKey = buildNoncePoolLockKey(walletAddress, network);
      const [currentValue] = await runKvPipeline(
        bindings,
        [['GET', lockKey]],
        'Offline nonce pool storage is unavailable.',
      );

      if (currentValue === lockToken) {
        await runKvPipeline(
          bindings,
          [['DEL', lockKey]],
          'Offline nonce pool storage is unavailable.',
        );
      }
    },
    async addNonceAccounts(walletAddress, network, nonceAccounts) {
      const uniqueNonceAccounts = uniqueAddresses(nonceAccounts);
      if (uniqueNonceAccounts.length === 0) {
        return;
      }

      const now = Date.now();
      await runKvPipeline(
        bindings,
        [
          ['SADD', buildNoncePoolSetKey(walletAddress, network), ...uniqueNonceAccounts],
          ...uniqueNonceAccounts.map((nonceAccount) => [
            'SET',
            buildNonceAccountRecordKey(walletAddress, network, nonceAccount),
            JSON.stringify({ walletAddress, network, nonceAccount, preparedAt: now }),
          ]),
        ],
        'Offline nonce pool storage is unavailable.',
      );
    },
    async removeNonceAccounts(walletAddress, network, nonceAccounts) {
      const uniqueNonceAccounts = uniqueAddresses(nonceAccounts);
      if (uniqueNonceAccounts.length === 0) {
        return;
      }

      await runKvPipeline(
        bindings,
        [
          ['SREM', buildNoncePoolSetKey(walletAddress, network), ...uniqueNonceAccounts],
          ...uniqueNonceAccounts.map((nonceAccount) => [
            'DEL',
            buildNonceAccountRecordKey(walletAddress, network, nonceAccount),
          ]),
        ],
        'Offline nonce pool storage is unavailable.',
      );
    },
    async listNonceAccounts(walletAddress, network) {
      const [members] = await runKvPipeline(
        bindings,
        [['SMEMBERS', buildNoncePoolSetKey(walletAddress, network)]],
        'Offline nonce pool storage is unavailable.',
      );

      if (!Array.isArray(members)) {
        return [];
      }

      return uniqueAddresses(
        members.filter(
          (member): member is string => typeof member === 'string' && isValidSolanaAddress(member),
        ),
      );
    },
  };
}

async function withOfflineIdempotency<T>(
  bindings: Bindings,
  descriptor: {
    walletAddress: string;
    network: Network;
    action: string;
    idempotencyKey: string;
    requestPayload: unknown;
  },
  producer: () => Promise<T>,
): Promise<T> {
  const idempotencyHash = await sha256Hex(descriptor.idempotencyKey);
  const requestHash = await sha256Hex(canonicalJsonStringify(descriptor.requestPayload));
  const storageKey = buildIdempotencyStorageKey(
    descriptor.walletAddress,
    descriptor.network,
    descriptor.action,
    idempotencyHash,
  );
  const store = offlineNonceStoreFactory(bindings);

  const existingRecord = await store.getIdempotencyRecord(storageKey);
  if (existingRecord) {
    if (existingRecord.requestHash !== requestHash) {
      throw new AppError({
        status: 409,
        code: 'INVALID_REQUEST',
        message: 'Idempotency key was already used with a different request.',
      });
    }

    return existingRecord.response as T;
  }

  const response = await producer();
  const now = Date.now();
  const record: StoredIdempotencyRecord<T> = {
    requestHash,
    response,
    createdAt: now,
    expiresAt: now + OFFLINE_IDEMPOTENCY_TTL_SEC * 1000,
  };

  const stored = await store.storeIdempotencyRecord(
    storageKey,
    record,
    OFFLINE_IDEMPOTENCY_TTL_SEC,
  );
  if (stored) {
    return response;
  }

  const concurrentRecord = await store.getIdempotencyRecord(storageKey);
  if (!concurrentRecord || concurrentRecord.requestHash !== requestHash) {
    throw new AppError({
      status: 409,
      code: 'INVALID_REQUEST',
      message: 'Idempotency key was already used with a different request.',
    });
  }

  return concurrentRecord.response as T;
}

function resolveConfiguredMint(
  bindings: Bindings,
  key: keyof Bindings,
  fallback: string | null,
  lockToFallback = false,
): { mint: string | null; reason: string | null } {
  const rawConfigured = bindings[key];
  const configured = typeof rawConfigured === 'string' ? rawConfigured.trim() : '';
  const candidate =
    lockToFallback && fallback
      ? fallback
      : configured && configured.length > 0
        ? configured
        : fallback;
  if (!candidate) {
    return {
      mint: null,
      reason: `${String(key)} is not configured for this network.`,
    };
  }

  if (!isValidSolanaAddress(candidate)) {
    return {
      mint: null,
      reason: `${String(key)} is not a valid Solana mint address.`,
    };
  }

  return {
    mint: candidate,
    reason: null,
  };
}

function buildStablecoin(
  bindings: Bindings,
  input: {
    symbol: StablecoinSymbol;
    name: string;
    key: keyof Bindings;
    fallback: string | null;
    lockToFallback?: boolean;
  },
): SupportedStablecoin {
  const resolvedMint = resolveConfiguredMint(
    bindings,
    input.key,
    input.fallback,
    input.lockToFallback,
  );

  return {
    symbol: input.symbol,
    name: input.name,
    mint: resolvedMint.mint,
    decimals: 6,
    programId: TOKEN_PROGRAM_ID,
    enabled: resolvedMint.mint !== null,
    reason: resolvedMint.reason,
  };
}

function getSupportedStablecoins(bindings: Bindings, network: Network): SupportedStablecoin[] {
  if (network === 'mainnet') {
    return [
      buildStablecoin(bindings, {
        symbol: 'USDC',
        name: 'USD Coin',
        key: 'OFFPAY_MAINNET_USDC_MINT',
        fallback: MAINNET_USDC_MINT,
        lockToFallback: true,
      }),
      buildStablecoin(bindings, {
        symbol: 'USDT',
        name: 'Tether USD',
        key: 'OFFPAY_MAINNET_USDT_MINT',
        fallback: MAINNET_USDT_MINT,
        lockToFallback: true,
      }),
    ];
  }

  return [
    buildStablecoin(bindings, {
      symbol: 'USDC',
      name: 'USD Coin',
      key: 'OFFPAY_DEVNET_USDC_MINT',
      fallback: DEVNET_USDC_MINT,
    }),
    buildStablecoin(bindings, {
      symbol: 'USDT',
      name: 'Tether USD',
      key: 'OFFPAY_DEVNET_USDT_MINT',
      fallback: null,
    }),
  ];
}

function requireSupportedStablecoin(
  bindings: Bindings,
  network: Network,
  mint: string,
): SupportedStablecoin {
  const supportedStablecoins = getSupportedStablecoins(bindings, network);
  const stablecoin = supportedStablecoins.find((entry) => entry.enabled && entry.mint === mint);
  if (!stablecoin || !stablecoin.mint) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Offline payment token is not supported on this network.',
    });
  }

  return stablecoin;
}

function associatedTokenAddress(owner: string, mint: string, programId: string): string {
  const [address] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBuffer(),
      new PublicKey(programId).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
  );

  return address.toBase58();
}

function accountExistsForProgram(account: RpcAccountInfo | undefined, programId: string): boolean {
  return account?.exists === true && account.owner === programId;
}

async function estimateOfflineNonceRent(
  bindings: Bindings,
  request: RentEstimateRequest,
): Promise<RentEstimateResponse> {
  const slotCount = clampSlotCount(request.slotCount);
  const lamportsPerNonceAccount = BigInt(
    await getMinimumBalanceForRentExemption(bindings, {
      network: request.network,
      space: NONCE_ACCOUNT_LENGTH,
    }),
  );
  const totalLamports = lamportsPerNonceAccount * BigInt(slotCount);
  const walletLamports = request.walletAddress
    ? await getWalletLamports(bindings, {
        address: request.walletAddress,
        network: request.network,
      })
    : null;
  const affordableSlotCount =
    walletLamports === null
      ? null
      : Math.min(OFFLINE_SLOT_MAX_COUNT, Number(BigInt(walletLamports) / lamportsPerNonceAccount));

  return {
    network: request.network,
    slotCount,
    lamportsPerNonceAccount: lamportsPerNonceAccount.toString(),
    totalLamports: totalLamports.toString(),
    estimatedSol: formatLamportsAsSol(totalLamports),
    walletLamports,
    affordableSlotCount,
    expiresAt: Date.now() + OFFLINE_RENT_ESTIMATE_TTL_MS,
  };
}

function serializeUnsignedTransaction(transaction: Transaction): string {
  return Buffer.from(
    transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  ).toString('base64');
}

async function prepareNoncePool(
  bindings: Bindings,
  request: PrepareNoncePoolRequest,
): Promise<PrepareNoncePoolResponse> {
  assertSolanaAddress(request.walletAddress, 'Wallet address is invalid.');
  assertSolanaAddress(request.nonceAuthority, 'Nonce authority is invalid.');
  if (request.walletAddress !== request.nonceAuthority) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Nonce authority must match the authenticated wallet.',
    });
  }

  const nonceAccounts = uniqueAddresses(request.nonceAccounts);
  if (nonceAccounts.length !== request.nonceAccounts.length) {
    throw new AppError({
      status: 400,
      code: 'INVALID_REQUEST',
      message: 'Nonce account list must not contain duplicates.',
    });
  }
  for (const nonceAccount of nonceAccounts) {
    assertSolanaAddress(nonceAccount, 'Nonce account address is invalid.');
    if (nonceAccount === request.walletAddress) {
      throw new AppError({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'Nonce account must be distinct from the wallet address.',
      });
    }
  }

  return withOfflineIdempotency(
    bindings,
    {
      walletAddress: request.walletAddress,
      network: request.network,
      action: 'nonce-pool-prepare',
      idempotencyKey: request.idempotencyKey,
      requestPayload: {
        walletAddress: request.walletAddress,
        nonceAuthority: request.nonceAuthority,
        nonceAccounts,
        network: request.network,
      },
    },
    async () => {
      const store = offlineNonceStoreFactory(bindings);
      const lockToken = await store.acquireNoncePoolLock(request.walletAddress, request.network);
      if (!lockToken) {
        throw new AppError({
          status: 409,
          code: 'INVALID_REQUEST',
          message: 'Offline payment slot pool is already being prepared for this wallet.',
          retryable: true,
          retryAfterMs: 1000,
        });
      }

      try {
        const existingNonceAccounts = await pruneMissingNoncePoolAccounts({
          bindings,
          store,
          walletAddress: request.walletAddress,
          network: request.network,
          nonceAccounts: await store.listNonceAccounts(request.walletAddress, request.network),
        });
        const existingSet = new Set(existingNonceAccounts);
        const newNonceAccounts = nonceAccounts.filter(
          (nonceAccount) => !existingSet.has(nonceAccount),
        );
        const resultingPoolSize = existingSet.size + newNonceAccounts.length;

        if (resultingPoolSize < OFFLINE_SLOT_MIN_COUNT) {
          throw new AppError({
            status: 400,
            code: 'INVALID_REQUEST',
            message: 'Offline payment slot preparation must keep the pool at or above 10 slots.',
          });
        }

        if (resultingPoolSize > OFFLINE_SLOT_MAX_COUNT) {
          throw new AppError({
            status: 400,
            code: 'INVALID_REQUEST',
            message: 'Offline payment slot preparation exceeds the 50 slot maximum.',
          });
        }

        const lamportsPerNonceAccount = BigInt(
          await getMinimumBalanceForRentExemption(bindings, {
            network: request.network,
            space: NONCE_ACCOUNT_LENGTH,
          }),
        );
        const { blockhash, lastValidBlockHeight } = await getLatestBlockhash(
          bindings,
          request.network,
        );
        const walletPubkey = new PublicKey(request.walletAddress);
        const authorityPubkey = new PublicKey(request.nonceAuthority);
        const rentLamports = lamportsPerNonceAccount * BigInt(newNonceAccounts.length);
        const unsignedTransactions = newNonceAccounts.map((nonceAccount) => {
          const noncePubkey = new PublicKey(nonceAccount);
          const transaction = new Transaction({
            feePayer: walletPubkey,
            recentBlockhash: blockhash,
          });
          transaction.lastValidBlockHeight = lastValidBlockHeight;
          transaction.add(
            SystemProgram.createAccount({
              fromPubkey: walletPubkey,
              newAccountPubkey: noncePubkey,
              lamports: toSafeLamportsNumber(lamportsPerNonceAccount),
              space: NONCE_ACCOUNT_LENGTH,
              programId: SystemProgram.programId,
            }),
            SystemProgram.nonceInitialize({
              noncePubkey,
              authorizedPubkey: authorityPubkey,
            }),
          );

          return {
            nonceAccount,
            transactionBase64: serializeUnsignedTransaction(transaction),
          };
        });

        await store.addNonceAccounts(request.walletAddress, request.network, newNonceAccounts);

        return {
          network: request.network,
          unsignedTransactions,
          rentLamports: rentLamports.toString(),
        };
      } finally {
        await store.releaseNoncePoolLock(request.walletAddress, request.network, lockToken);
      }
    },
  );
}

function parseNonceAccount(
  account: RpcAccountInfo,
  walletAddress: string,
  rentLamports: bigint,
  checkedAt: number,
): NoncePoolSlotStatus {
  if (!account.exists) {
    return {
      nonceAccount: account.address,
      state: 'missing',
      nonceValue: null,
      authority: null,
      lamports: null,
      rentExempt: null,
      checkedAt,
    };
  }

  if (account.owner !== SystemProgram.programId.toBase58() || !account.dataBase64) {
    return {
      nonceAccount: account.address,
      state: 'stale',
      nonceValue: null,
      authority: null,
      lamports: account.lamports,
      rentExempt: account.lamports ? BigInt(account.lamports) >= rentLamports : null,
      checkedAt,
    };
  }

  try {
    const decodedNonceAccount = NonceAccount.fromAccountData(
      Buffer.from(account.dataBase64, 'base64'),
    );
    const authority = decodedNonceAccount.authorizedPubkey.toBase58();
    const authorityMatches = authority === walletAddress;

    return {
      nonceAccount: account.address,
      state: authorityMatches ? 'ready' : 'invalid_authority',
      nonceValue: decodedNonceAccount.nonce,
      authority,
      lamports: account.lamports,
      rentExempt: account.lamports ? BigInt(account.lamports) >= rentLamports : null,
      checkedAt,
    };
  } catch {
    return {
      nonceAccount: account.address,
      state: 'stale',
      nonceValue: null,
      authority: null,
      lamports: account.lamports,
      rentExempt: account.lamports ? BigInt(account.lamports) >= rentLamports : null,
      checkedAt,
    };
  }
}

async function pruneMissingNoncePoolAccounts(params: {
  bindings: Bindings;
  store: OfflineNonceStore;
  walletAddress: string;
  network: Network;
  nonceAccounts: string[];
}): Promise<string[]> {
  if (params.nonceAccounts.length === 0) {
    return [];
  }

  const accounts = await getRpcAccounts(params.bindings, {
    network: params.network,
    addresses: params.nonceAccounts,
  });
  const missingNonceAccounts = accounts.accounts
    .filter((account) => !account.exists)
    .map((account) => account.address);

  if (missingNonceAccounts.length === 0) {
    return params.nonceAccounts;
  }

  await params.store.removeNonceAccounts(
    params.walletAddress,
    params.network,
    missingNonceAccounts,
  );
  const missingSet = new Set(missingNonceAccounts);
  return params.nonceAccounts.filter((nonceAccount) => !missingSet.has(nonceAccount));
}

async function readNonceSlotStatus(
  bindings: Bindings,
  request: {
    walletAddress: string;
    network: Network;
    nonceAccount: string;
    rentLamports?: bigint;
  },
): Promise<NoncePoolSlotStatus> {
  const rentLamports =
    request.rentLamports ??
    BigInt(
      await getMinimumBalanceForRentExemption(bindings, {
        network: request.network,
        space: NONCE_ACCOUNT_LENGTH,
      }),
    );
  const checkedAt = Date.now();
  const accounts = await getRpcAccounts(bindings, {
    network: request.network,
    addresses: [request.nonceAccount],
  });

  return parseNonceAccount(accounts.accounts[0]!, request.walletAddress, rentLamports, checkedAt);
}

async function prepareNonceAdvance(
  bindings: Bindings,
  request: AdvanceNoncePoolRequest,
): Promise<AdvanceNoncePoolResponse> {
  assertSolanaAddress(request.walletAddress, 'Wallet address is invalid.');
  assertSolanaAddress(request.nonceAccount, 'Nonce account address is invalid.');

  return withOfflineIdempotency(
    bindings,
    {
      walletAddress: request.walletAddress,
      network: request.network,
      action: 'nonce-pool-advance',
      idempotencyKey: request.idempotencyKey,
      requestPayload: {
        walletAddress: request.walletAddress,
        nonceAccount: request.nonceAccount,
        network: request.network,
      },
    },
    async () => {
      const slotStatus = await readNonceSlotStatus(bindings, request);
      if (
        slotStatus.state !== 'ready' ||
        !slotStatus.nonceValue ||
        slotStatus.authority !== request.walletAddress
      ) {
        throw new AppError({
          status: 400,
          code: 'INVALID_REQUEST',
          message: 'Nonce account is not ready for this authenticated wallet.',
        });
      }

      const walletPubkey = new PublicKey(request.walletAddress);
      const noncePubkey = new PublicKey(request.nonceAccount);
      const nonceInstruction = SystemProgram.nonceAdvance({
        noncePubkey,
        authorizedPubkey: walletPubkey,
      });
      const transaction = new Transaction({
        feePayer: walletPubkey,
        nonceInfo: {
          nonce: slotStatus.nonceValue,
          nonceInstruction,
        },
      });

      return {
        network: request.network,
        nonceAccount: request.nonceAccount,
        nonceValue: slotStatus.nonceValue,
        authority: slotStatus.authority,
        transactionBase64: serializeUnsignedTransaction(transaction),
      };
    },
  );
}

async function getNoncePoolStatus(
  bindings: Bindings,
  request: NoncePoolStatusRequest,
): Promise<NoncePoolStatusResponse> {
  assertSolanaAddress(request.walletAddress, 'Wallet address is invalid.');
  const targetSlotCount = clampSlotCount(request.targetSlotCount ?? OFFLINE_SLOT_MIN_COUNT);
  const store = offlineNonceStoreFactory(bindings);
  const nonceAccounts = await store.listNonceAccounts(request.walletAddress, request.network);
  const fetchedAt = Date.now();

  if (nonceAccounts.length === 0) {
    return {
      network: request.network,
      walletAddress: request.walletAddress,
      targetSlotCount,
      counts: {
        ready: 0,
        locked: 0,
        settling: 0,
        stale: 0,
        missing: 0,
        invalidAuthority: 0,
        needsRefill: targetSlotCount,
      },
      slots: [],
      fetchedAt,
    };
  }

  const rentLamports = BigInt(
    await getMinimumBalanceForRentExemption(bindings, {
      network: request.network,
      space: NONCE_ACCOUNT_LENGTH,
    }),
  );
  const accounts = await getRpcAccounts(bindings, {
    network: request.network,
    addresses: nonceAccounts,
  });
  const slots = accounts.accounts.map((account) =>
    parseNonceAccount(account, request.walletAddress, rentLamports, fetchedAt),
  );
  const ready = slots.filter((slot) => slot.state === 'ready').length;
  const missing = slots.filter((slot) => slot.state === 'missing').length;
  const invalidAuthority = slots.filter((slot) => slot.state === 'invalid_authority').length;
  const stale = slots.filter((slot) => slot.state === 'stale').length + invalidAuthority;
  const missingNonceAccounts = slots
    .filter((slot) => slot.state === 'missing')
    .map((slot) => slot.nonceAccount);
  if (missingNonceAccounts.length > 0) {
    await store.removeNonceAccounts(request.walletAddress, request.network, missingNonceAccounts);
  }

  return {
    network: request.network,
    walletAddress: request.walletAddress,
    targetSlotCount,
    counts: {
      ready,
      locked: 0,
      settling: 0,
      stale,
      missing,
      invalidAuthority,
      needsRefill: Math.max(0, targetSlotCount - ready),
    },
    slots,
    fetchedAt,
  };
}

async function getOfflineTokenContext(
  bindings: Bindings,
  request: TokenContextRequest,
): Promise<TokenContextResponse> {
  assertSolanaAddress(request.mint, 'Mint address is invalid.');
  assertSolanaAddress(request.sender, 'Sender wallet address is invalid.');
  assertSolanaAddress(request.recipient, 'Recipient wallet address is invalid.');

  const stablecoin = requireSupportedStablecoin(bindings, request.network, request.mint);
  const supportedStablecoins = getSupportedStablecoins(bindings, request.network);
  const senderAta = associatedTokenAddress(request.sender, request.mint, stablecoin.programId);
  const recipientAta = associatedTokenAddress(
    request.recipient,
    request.mint,
    stablecoin.programId,
  );
  const accounts = await getRpcAccounts(bindings, {
    network: request.network,
    addresses: [senderAta, recipientAta],
  });
  const senderAccountExists = accountExistsForProgram(accounts.accounts[0], stablecoin.programId);
  const recipientAccountExists = accountExistsForProgram(
    accounts.accounts[1],
    stablecoin.programId,
  );

  return {
    network: request.network,
    owner: request.sender,
    sender: request.sender,
    recipient: request.recipient,
    mint: request.mint,
    symbol: stablecoin.symbol,
    name: stablecoin.name,
    decimals: stablecoin.decimals,
    programId: stablecoin.programId,
    associatedTokenAddress: senderAta,
    accountExists: senderAccountExists,
    senderTokenAccount: {
      associatedTokenAddress: senderAta,
      accountExists: senderAccountExists,
    },
    recipientTokenAccount: {
      associatedTokenAddress: recipientAta,
      accountExists: recipientAccountExists,
    },
    supportedStablecoins,
    fetchedAt: Date.now(),
  };
}

function setOfflineNonceStoreFactory(factory: OfflineNonceStoreFactory): void {
  offlineNonceStoreFactory = factory;
}

function resetOfflineNonceStoreFactory(): void {
  offlineNonceStoreFactory = createOfflineNonceStore;
}

export {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  DEVNET_USDC_MINT,
  MAINNET_USDC_MINT,
  MAINNET_USDT_MINT,
  OFFLINE_IDEMPOTENCY_TTL_SEC,
  OFFLINE_RENT_ESTIMATE_TTL_MS,
  OFFLINE_SLOT_MAX_COUNT,
  OFFLINE_SLOT_MIN_COUNT,
  TOKEN_PROGRAM_ID,
  estimateOfflineNonceRent,
  getNoncePoolStatus,
  getOfflineTokenContext,
  getSupportedStablecoins,
  prepareNonceAdvance,
  prepareNoncePool,
  resetOfflineNonceStoreFactory,
  setOfflineNonceStoreFactory,
  type AdvanceNoncePoolRequest,
  type AdvanceNoncePoolResponse,
  type NoncePoolSlotStatus,
  type NoncePoolStatusRequest,
  type NoncePoolStatusResponse,
  type OfflineNonceStore,
  type OfflineNonceStoreFactory,
  type PrepareNoncePoolRequest,
  type PrepareNoncePoolResponse,
  type PreparedNonceTransaction,
  type RentEstimateRequest,
  type RentEstimateResponse,
  type StablecoinSymbol,
  type StoredIdempotencyRecord,
  type SupportedStablecoin,
  type TokenAccountContext,
  type TokenContextRequest,
  type TokenContextResponse,
};
