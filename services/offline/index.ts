import { Buffer } from 'buffer';

import {
  getMinimumBalanceForRentExemption,
  getRpcAccounts,
  getRpcLatestBlockhash,
} from '@/services/rpc';
import {
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  deriveAssociatedTokenAddress,
} from '@/lib/crypto/solana-token-accounts';
import {
  getStablecoinPolicyEntries,
  getStablecoinSymbolForMint,
  isKnownStablecoinMint,
} from '@/lib/policy/stablecoin-policy';

import type {
  OfflineNoncePoolAdvanceRequest,
  OfflineNoncePoolAdvanceResponse,
  OfflineNoncePoolPrepareRequest,
  OfflineNoncePoolPrepareResponse,
  OfflineNoncePoolStatusResponse,
  OfflineRentEstimateResponse,
  OfflineSupportedStablecoin,
  OfflineTokenContextResponse,
  OffpayNetwork,
  RpcAccountRecord,
} from '@/types/offpay-api';

const LAMPORTS_PER_SOL = 1_000_000_000n;
const NONCE_ACCOUNT_LENGTH = 80;
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const RENT_ESTIMATE_TTL_MS = 5 * 60_000;
const SLOT_MAX_COUNT = 50;

async function loadWeb3() {
  return import('@solana/web3.js');
}

async function loadNonceAccountConstructor(): Promise<
  typeof import('@solana/web3.js')['NonceAccount'] | null
> {
  try {
    const { NonceAccount } = await loadWeb3();
    return NonceAccount;
  } catch {
    return null;
  }
}

function clampSlotCount(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(Math.max(Math.trunc(value), 1), SLOT_MAX_COUNT);
}

function formatSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = lamports % LAMPORTS_PER_SOL;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(9, '0').replace(/0+$/, '')}`;
}

function serializeUnsigned(transaction: {
  serialize: (config: {
    requireAllSignatures: boolean;
    verifySignatures: boolean;
  }) => Uint8Array;
}): string {
  return Buffer.from(
    transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  ).toString('base64');
}

function toSafeLamports(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Lamports exceed the safe integer range.');
  }
  return Number(value);
}

function supportedStablecoins(network: OffpayNetwork): OfflineSupportedStablecoin[] {
  return getStablecoinPolicyEntries(network).map((stablecoin) => ({
    ...stablecoin,
    programId: SPL_TOKEN_PROGRAM_ID,
  }));
}

function stablecoinForMint(network: OffpayNetwork, mint: string): OfflineSupportedStablecoin {
  const match = supportedStablecoins(network).find((entry) => entry.enabled && entry.mint === mint);
  if (match != null) return match;
  if (isKnownStablecoinMint(network, mint)) {
    const symbol = getStablecoinSymbolForMint(network, mint) ?? 'USDC';
    return {
      symbol,
      mint,
      decimals: 6,
      enabled: true,
      name: symbol === 'USDC' ? 'USD Coin' : 'Tether USD',
      programId: SPL_TOKEN_PROGRAM_ID,
    };
  }
  throw new Error('Offline payment token is not supported on this network.');
}

function accountExistsForProgram(account: RpcAccountRecord | null | undefined, programId: string): boolean {
  return account?.owner === programId;
}

function buildNonceAccountStatus(params: {
  account: RpcAccountRecord | null;
  address: string;
  walletAddress: string;
  rentLamports: bigint;
  checkedAt: number;
  NonceAccount: typeof import('@solana/web3.js')['NonceAccount'] | null;
}): OfflineNoncePoolStatusResponse['slots'][number] {
  if (params.account == null) {
    return {
      nonceAccount: params.address,
      state: 'missing',
      nonceValue: null,
      authority: params.walletAddress,
      lamports: '0',
      rentExempt: false,
      checkedAt: params.checkedAt,
    };
  }

  if (params.account.owner !== SYSTEM_PROGRAM_ID || params.account.dataBase64 == null) {
    return {
      nonceAccount: params.address,
      state: 'stale',
      nonceValue: null,
      authority: params.walletAddress,
      lamports: String(params.account.lamports ?? '0'),
      rentExempt: BigInt(String(params.account.lamports ?? '0')) >= params.rentLamports,
      checkedAt: params.checkedAt,
    };
  }

  if (params.NonceAccount == null) {
    return {
      nonceAccount: params.address,
      state: 'stale',
      nonceValue: null,
      authority: params.walletAddress,
      lamports: String(params.account.lamports ?? '0'),
      rentExempt: BigInt(String(params.account.lamports ?? '0')) >= params.rentLamports,
      checkedAt: params.checkedAt,
    };
  }

  try {
    const decoded = params.NonceAccount.fromAccountData(
      Buffer.from(params.account.dataBase64, 'base64'),
    );
    const authority = decoded.authorizedPubkey.toBase58();
    return {
      nonceAccount: params.address,
      state: authority === params.walletAddress ? 'ready' : 'stale',
      nonceValue: decoded.nonce,
      authority,
      lamports: String(params.account.lamports ?? '0'),
      rentExempt: BigInt(String(params.account.lamports ?? '0')) >= params.rentLamports,
      checkedAt: params.checkedAt,
    };
  } catch {
    return {
      nonceAccount: params.address,
      state: 'stale',
      nonceValue: null,
      authority: params.walletAddress,
      lamports: String(params.account.lamports ?? '0'),
      rentExempt: BigInt(String(params.account.lamports ?? '0')) >= params.rentLamports,
      checkedAt: params.checkedAt,
    };
  }
}

export async function getOfflineRentEstimate(params: {
  walletAddress: string;
  slotCount: number;
  network: OffpayNetwork;
}): Promise<OfflineRentEstimateResponse> {
  const slotCount = clampSlotCount(params.slotCount);
  const lamportsPerNonceAccount = BigInt(
    await getMinimumBalanceForRentExemption({
      network: params.network,
      space: NONCE_ACCOUNT_LENGTH,
    }),
  );
  const totalLamports = lamportsPerNonceAccount * BigInt(slotCount);
  return {
    network: params.network,
    slotCount,
    lamportsPerNonceAccount: lamportsPerNonceAccount.toString(),
    totalLamports: totalLamports.toString(),
    estimatedSol: formatSol(totalLamports),
    expiresAt: Date.now() + RENT_ESTIMATE_TTL_MS,
  };
}

export async function prepareOfflineNoncePool(
  request: OfflineNoncePoolPrepareRequest,
): Promise<OfflineNoncePoolPrepareResponse> {
  if (request.walletAddress !== request.nonceAuthority) {
    throw new Error('Nonce authority must match the wallet address.');
  }
  const nonceAccounts = Array.from(new Set(request.nonceAccounts));
  const lamportsPerNonceAccount = BigInt(
    await getMinimumBalanceForRentExemption({
      network: request.network,
      space: NONCE_ACCOUNT_LENGTH,
    }),
  );
  const latest = await getRpcLatestBlockhash(request.network);
  const { PublicKey, SystemProgram, Transaction } = await loadWeb3();
  const wallet = new PublicKey(request.walletAddress);
  const authority = new PublicKey(request.nonceAuthority);
  const unsignedTransactions = nonceAccounts.map((nonceAccount) => {
    const noncePubkey = new PublicKey(nonceAccount);
    const transaction = new Transaction({
      feePayer: wallet,
      recentBlockhash: latest.blockhash,
    });
    transaction.lastValidBlockHeight = latest.lastValidBlockHeight;
    transaction.add(
      SystemProgram.createAccount({
        fromPubkey: wallet,
        newAccountPubkey: noncePubkey,
        lamports: toSafeLamports(lamportsPerNonceAccount),
        space: NONCE_ACCOUNT_LENGTH,
        programId: SystemProgram.programId,
      }),
      SystemProgram.nonceInitialize({
        noncePubkey,
        authorizedPubkey: authority,
      }),
    );
    return {
      nonceAccount,
      transactionBase64: serializeUnsigned(transaction),
    };
  });

  return {
    network: request.network,
    unsignedTransactions,
    rentLamports: (lamportsPerNonceAccount * BigInt(unsignedTransactions.length)).toString(),
  };
}

export async function prepareOfflineNonceAdvance(
  request: OfflineNoncePoolAdvanceRequest,
): Promise<OfflineNoncePoolAdvanceResponse> {
  const status = await getOfflineNoncePoolStatus({
    walletAddress: request.walletAddress,
    targetSlotCount: 1,
    network: request.network,
    nonceAccounts: [request.nonceAccount],
  });
  const slot = status.slots[0];
  if (slot == null || slot.state !== 'ready' || slot.nonceValue == null) {
    throw new Error('Nonce account is not ready for this wallet.');
  }
  const { PublicKey, SystemProgram, Transaction } = await loadWeb3();
  const wallet = new PublicKey(request.walletAddress);
  const noncePubkey = new PublicKey(request.nonceAccount);
  const nonceInstruction = SystemProgram.nonceAdvance({
    noncePubkey,
    authorizedPubkey: wallet,
  });
  const transaction = new Transaction({
    feePayer: wallet,
    nonceInfo: {
      nonce: slot.nonceValue,
      nonceInstruction,
    },
  });
  return {
    network: request.network,
    nonceAccount: request.nonceAccount,
    transactionBase64: serializeUnsigned(transaction),
  };
}

export async function getOfflineNoncePoolStatus(params: {
  walletAddress: string;
  targetSlotCount: number;
  network: OffpayNetwork;
  nonceAccounts?: string[];
}): Promise<OfflineNoncePoolStatusResponse> {
  const targetSlotCount = clampSlotCount(params.targetSlotCount);
  const nonceAccounts = params.nonceAccounts ?? [];
  const rentLamports = BigInt(
    await getMinimumBalanceForRentExemption({
      network: params.network,
      space: NONCE_ACCOUNT_LENGTH,
    }),
  );
  const accounts = nonceAccounts.length > 0
    ? await getRpcAccounts({ network: params.network, addresses: nonceAccounts })
    : { accounts: [] };
  const checkedAt = Date.now();
  // Load `@solana/web3.js` once for the whole batch instead of on
  // every slot. The dynamic import is cached after the first call,
  // but the per-slot await still hops through the microtask queue.
  // For a 50-slot status pool that cumulative microtask cost shows
  // up as a flat delay between the RPC fetch and the UI update.
  const NonceAccount = await loadNonceAccountConstructor();
  const slots = nonceAccounts.map((nonceAccount, index) =>
    buildNonceAccountStatus({
      account: accounts.accounts[index],
      address: nonceAccount,
      walletAddress: params.walletAddress,
      rentLamports,
      checkedAt,
      NonceAccount,
    }),
  );
  const ready = slots.filter((slot) => slot.state === 'ready').length;
  const missing = slots.filter((slot) => slot.state === 'missing').length;
  const stale = slots.filter((slot) => slot.state === 'stale').length;
  return {
    network: params.network,
    walletAddress: params.walletAddress,
    targetSlotCount,
    counts: {
      ready,
      locked: 0,
      settling: 0,
      stale,
      missing,
      needsRefill: Math.max(0, targetSlotCount - ready),
    },
    slots,
    fetchedAt: checkedAt,
  };
}

export async function getOfflineTokenContext(params: {
  mint: string;
  sender: string;
  recipient: string;
  network: OffpayNetwork;
}): Promise<OfflineTokenContextResponse> {
  const stablecoin = stablecoinForMint(params.network, params.mint);
  const programId = stablecoin.programId ?? SPL_TOKEN_PROGRAM_ID;
  const senderAta = deriveAssociatedTokenAddress({
    owner: params.sender,
    mint: params.mint,
    tokenProgramId: programId,
  });
  const recipientAta = deriveAssociatedTokenAddress({
    owner: params.recipient,
    mint: params.mint,
    tokenProgramId: programId,
  });
  const accounts = await getRpcAccounts({
    network: params.network,
    addresses: [senderAta, recipientAta],
  });

  return {
    network: params.network,
    sender: params.sender,
    recipient: params.recipient,
    mint: params.mint,
    symbol: stablecoin.symbol,
    name: stablecoin.name ?? stablecoin.symbol,
    decimals: stablecoin.decimals,
    programId,
    senderTokenAccount: {
      associatedTokenAddress: senderAta,
      accountExists: accountExistsForProgram(accounts.accounts[0], programId),
    },
    recipientTokenAccount: {
      associatedTokenAddress: recipientAta,
      accountExists: accountExistsForProgram(accounts.accounts[1], programId),
    },
    supportedStablecoins: supportedStablecoins(params.network),
    fetchedAt: Date.now(),
  };
}

export { SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID };
