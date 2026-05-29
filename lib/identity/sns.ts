import { Buffer } from 'buffer';

import { getRpcAccounts, getRpcTokenLargestAccounts } from '@/lib/api/offpay-api-client';
import { isValidSolanaAddress } from '@/lib/crypto/solana-address';

import type { OffpayNetwork, RpcAccountRecord } from '@/types/offpay-api';
import type { AccountInfo, Commitment, PublicKey } from '@solana/web3.js';

const SNS_RESOLUTION_NETWORK: OffpayNetwork = 'mainnet';
const SNS_CACHE_TTL_MS = 60 * 1000;
const SNS_RESOLUTION_TIMEOUT_MS = 6_000;
type PublicKeyCtor = typeof import('@solana/web3.js').PublicKey;

interface CachedSnsResolution {
  address: string;
  expiresAt: number;
}

const snsResolutionCache = new Map<string, CachedSnsResolution>();
let publicKeyCtorPromise: Promise<PublicKeyCtor> | null = null;

function getPublicKeyCtor(): Promise<PublicKeyCtor> {
  publicKeyCtorPromise ??= import('@solana/web3.js').then((module) => module.PublicKey);
  return publicKeyCtorPromise;
}

function normalizeLamports(value: RpcAccountRecord['lamports']): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeRentEpoch(value: RpcAccountRecord['rentEpoch']): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function decodeRpcAccountData(account: RpcAccountRecord): Buffer {
  const encoded = account.dataBase64 ?? account.data;
  if (typeof encoded !== 'string' || encoded.length === 0) {
    return Buffer.alloc(0);
  }

  return Buffer.from(encoded, 'base64');
}

function normalizeRpcAccount(
  account: RpcAccountRecord | null,
  PublicKeyValue: PublicKeyCtor,
): AccountInfo<Buffer> | null {
  if (account == null || account.owner == null || !isValidSolanaAddress(account.owner)) {
    return null;
  }

  return {
    data: decodeRpcAccountData(account),
    executable: account.executable === true,
    lamports: normalizeLamports(account.lamports),
    owner: new PublicKeyValue(account.owner),
    rentEpoch: normalizeRentEpoch(account.rentEpoch),
  };
}

class OffpaySnsConnection {
  async getAccountInfo(
    publicKey: PublicKey,
    _commitmentOrConfig?: Commitment | unknown,
  ): Promise<AccountInfo<Buffer> | null> {
    const [account] = await this.getMultipleAccountsInfo([publicKey]);
    return account ?? null;
  }

  async getMultipleAccountsInfo(
    publicKeys: PublicKey[],
    _commitmentOrConfig?: Commitment | unknown,
  ): Promise<Array<AccountInfo<Buffer> | null>> {
    const response = await getRpcAccounts({
      network: SNS_RESOLUTION_NETWORK,
      addresses: publicKeys.map((publicKey) => publicKey.toBase58()),
    });

    const PublicKeyValue = await getPublicKeyCtor();
    return publicKeys.map((_, index) =>
      normalizeRpcAccount(response.accounts[index] ?? null, PublicKeyValue),
    );
  }

  async getTokenLargestAccounts(mint: PublicKey): Promise<{
    value: Array<{
      address: PublicKey;
      amount: string;
      decimals: number;
      uiAmount: number | null;
      uiAmountString: string | null;
    }>;
  }> {
    const [response, PublicKeyValue] = await Promise.all([
      getRpcTokenLargestAccounts({
        network: SNS_RESOLUTION_NETWORK,
        mint: mint.toBase58(),
      }),
      getPublicKeyCtor(),
    ]);

    return {
      value: response.accounts.map((account) => ({
        address: new PublicKeyValue(account.address),
        amount: account.amount,
        decimals: account.decimals,
        uiAmount: account.uiAmount,
        uiAmountString: account.uiAmountString,
      })),
    };
  }
}

const snsConnection = new OffpaySnsConnection();

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }
  });
}

export function normalizeSnsNameInput(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/^@+/, '') ?? '';
  if (trimmed.length === 0 || isValidSolanaAddress(trimmed)) return null;
  if (trimmed.length > 128 || /\s/.test(trimmed)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;

  const normalized = trimmed.toLowerCase();
  return normalized.endsWith('.sol') ? normalized : `${normalized}.sol`;
}

export function isSnsNameInput(value: string | null | undefined): boolean {
  return normalizeSnsNameInput(value) != null;
}

async function resolveSnsNameWithoutTimeout(domain: string): Promise<string> {
  const { resolve } = await import('@bonfida/spl-name-service');
  const publicKey = await resolve(snsConnection as never, domain);
  const address = publicKey.toBase58();
  if (!isValidSolanaAddress(address)) {
    throw new Error('SNS resolved to an invalid wallet address.');
  }

  snsResolutionCache.set(domain, {
    address,
    expiresAt: Date.now() + SNS_CACHE_TTL_MS,
  });

  return address;
}

export async function resolveSnsName(value: string): Promise<string> {
  const domain = normalizeSnsNameInput(value);
  if (domain == null) {
    throw new Error('Enter a valid Solana address or SNS name.');
  }

  const cached = snsResolutionCache.get(domain);
  if (cached != null && cached.expiresAt > Date.now()) {
    return cached.address;
  }

  return withTimeout(
    resolveSnsNameWithoutTimeout(domain),
    SNS_RESOLUTION_TIMEOUT_MS,
    'SNS lookup timed out. Check the name or paste a wallet address.',
  );
}
