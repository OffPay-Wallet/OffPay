import { isValidSolanaAddress } from '@/lib/crypto/solana-address';

import type { OffpayNetwork } from '@/types/offpay-api';

export type OffpayStablecoinSymbol = 'USDC' | 'USDT';

export interface StablecoinPolicyEntry {
  symbol: OffpayStablecoinSymbol;
  mint: string;
  decimals: number;
  enabled: boolean;
  name: string;
}

const STABLECOIN_SYMBOLS = new Set<OffpayStablecoinSymbol>(['USDC', 'USDT']);

const STABLECOIN_MINTS: Record<OffpayNetwork, Record<OffpayStablecoinSymbol, readonly string[]>> = {
  mainnet: {
    USDC: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'],
    USDT: ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'],
  },
  devnet: {
    USDC: ['4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'],
    USDT: [],
  },
};

const STABLECOIN_METADATA: Record<OffpayStablecoinSymbol, { decimals: number; name: string }> = {
  USDC: {
    decimals: 6,
    name: 'USD Coin',
  },
  USDT: {
    decimals: 6,
    name: 'Tether USD',
  },
};

export const PRIVATE_PAYMENT_LAYER_LABEL = 'Umbra / MagicBlock Private Payments';
export const STABLECOIN_ONLY_PAYMENT_MESSAGE =
  'Private and offline P2P payments are stablecoin-only: USDC or USDT. SOL is used only for fees.';

export function normalizeStablecoinSymbol(value: string | null | undefined): OffpayStablecoinSymbol | null {
  const normalized = value?.trim().toUpperCase();
  if (normalized === 'USDC' || normalized === 'USDT') return normalized;
  return null;
}

export function getStablecoinSymbolForMint(
  network: OffpayNetwork,
  mint: string | null | undefined,
): OffpayStablecoinSymbol | null {
  const normalized = mint?.trim();
  if (normalized == null || normalized.length === 0 || !isValidSolanaAddress(normalized)) {
    return null;
  }

  for (const symbol of STABLECOIN_SYMBOLS) {
    if (STABLECOIN_MINTS[network][symbol].includes(normalized)) {
      return symbol;
    }
  }

  return null;
}

export function isKnownStablecoinMint(
  network: OffpayNetwork,
  mint: string | null | undefined,
): boolean {
  return getStablecoinSymbolForMint(network, mint) != null;
}

export function getStablecoinPolicyEntries(network: OffpayNetwork): StablecoinPolicyEntry[] {
  return Array.from(STABLECOIN_SYMBOLS, (symbol) => {
    const mint = STABLECOIN_MINTS[network][symbol][0] ?? '';
    const metadata = STABLECOIN_METADATA[symbol];
    return {
      symbol,
      mint,
      decimals: metadata.decimals,
      enabled: mint.length > 0,
      name: metadata.name,
    };
  });
}

export function isSupportedStablecoinToken(params: {
  network: OffpayNetwork;
  token: string | null | undefined;
  symbol?: string | null;
}): boolean {
  const normalizedToken = params.token?.trim();
  if (normalizedToken != null && normalizedToken.length > 0) {
    if (isValidSolanaAddress(normalizedToken)) {
      return isKnownStablecoinMint(params.network, normalizedToken);
    }

    return normalizeStablecoinSymbol(normalizedToken) != null;
  }

  return normalizeStablecoinSymbol(params.symbol) != null;
}
