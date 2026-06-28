import { isValidSolanaAddress } from '@/lib/crypto/solana-address';

import type { OffpayNetwork } from '@/types/offpay-api';

export type UmbraTokenSymbol = 'USDC' | 'USDT' | 'wSOL' | 'UMBRA' | 'dUSDC' | 'dUSDT';

export interface UmbraSupportedToken {
  symbol: UmbraTokenSymbol;
  name: string;
  mint: string;
  decimals: number;
  encryptedBalance: boolean;
  mixer: boolean;
  aliases?: readonly string[];
}

const MAINNET_TOKENS: UmbraSupportedToken[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    decimals: 6,
    encryptedBalance: true,
    mixer: true,
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    decimals: 6,
    encryptedBalance: true,
    mixer: true,
  },
  {
    symbol: 'wSOL',
    name: 'Wrapped SOL',
    mint: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    encryptedBalance: true,
    mixer: true,
  },
  {
    symbol: 'UMBRA',
    name: 'Umbra',
    mint: 'PRVT6TB7uss3FrUd2D9xs2zqDBsa3GbMJMwCQsgmeta',
    decimals: 6,
    encryptedBalance: true,
    mixer: true,
  },
];

const DEVNET_TOKENS: UmbraSupportedToken[] = [
  {
    symbol: 'dUSDC',
    name: 'dUSDC',
    mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
    decimals: 6,
    encryptedBalance: true,
    mixer: true,
    aliases: ['USDC'],
  },
  {
    symbol: 'dUSDT',
    name: 'dUSDT',
    mint: 'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6',
    decimals: 6,
    encryptedBalance: true,
    mixer: true,
    aliases: ['USDT'],
  },
];

const TOKENS_BY_NETWORK: Record<OffpayNetwork, UmbraSupportedToken[]> = {
  mainnet: MAINNET_TOKENS,
  devnet: DEVNET_TOKENS,
};

export function getUmbraSupportedTokens(network: OffpayNetwork): UmbraSupportedToken[] {
  return TOKENS_BY_NETWORK[network];
}

export function getUmbraSupportedTokenSymbols(network: OffpayNetwork): UmbraTokenSymbol[] {
  return getUmbraSupportedTokens(network).map((token) => token.symbol);
}

export function getUmbraTokenBySymbol(
  network: OffpayNetwork,
  symbol: string | null | undefined,
): UmbraSupportedToken | null {
  const normalized = symbol?.trim().toUpperCase();
  if (normalized == null || normalized.length === 0) return null;
  return (
    getUmbraSupportedTokens(network).find(
      (token) =>
        token.symbol.toUpperCase() === normalized ||
        token.aliases?.some((alias) => alias.toUpperCase() === normalized) === true,
    ) ?? null
  );
}

export function getUmbraTokenByMint(
  network: OffpayNetwork,
  mint: string | null | undefined,
): UmbraSupportedToken | null {
  const normalized = mint?.trim();
  if (normalized == null || !isValidSolanaAddress(normalized)) return null;
  return getUmbraSupportedTokens(network).find((token) => token.mint === normalized) ?? null;
}

export function resolveUmbraSupportedToken(params: {
  network: OffpayNetwork;
  token: string;
  tokenMint?: string | null;
  requireMixer?: boolean;
}): UmbraSupportedToken {
  const normalizedMint = params.tokenMint?.trim();
  const token =
    normalizedMint != null && normalizedMint.length > 0
      ? getUmbraTokenByMint(params.network, normalizedMint)
      : getUmbraTokenBySymbol(params.network, params.token);

  if (!isUmbraNetworkSupported(params.network)) {
    throw new Error(`Umbra encrypted balances are not available on ${params.network}.`);
  }
  if (token == null || !token.encryptedBalance) {
    throw new Error(`Umbra encrypted balances do not support this token on ${params.network}.`);
  }
  if (params.requireMixer === true && !token.mixer) {
    throw new Error(`Umbra mixer is not available for ${token.symbol} on ${params.network}.`);
  }

  return token;
}

export function isUmbraNetworkSupported(network: OffpayNetwork): boolean {
  return TOKENS_BY_NETWORK[network].length > 0;
}

export function isUmbraMixerNetwork(network: OffpayNetwork): boolean {
  return (
    isUmbraNetworkSupported(network) &&
    getUmbraSupportedTokens(network).some((token) => token.mixer)
  );
}
