import { decimalInputToAtomicAmount } from '@/lib/policy/token-amounts';
import { getStablecoinPolicyEntries } from '@/lib/policy/stablecoin-policy';
import {
  getUmbraSupportedTokens,
  getUmbraTokenByMint,
  getUmbraTokenBySymbol,
} from '@/lib/umbra/umbra-supported-tokens';

import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';
import type { PayrollTokenContext } from '@/lib/payroll/payroll-validation';
import type { OffpayNetwork, WalletBalanceResponse } from '@/types/offpay-api';

/**
 * Whether the active wallet can locally sign payroll transactions. Privy
 * embedded/address-only wallets hold no signing material on-device, so they
 * are blocked before confirmation.
 */
export function walletCanSignPayroll(importMethod: WalletImportMethod | null | undefined): boolean {
  return (
    importMethod === 'generated' ||
    importMethod === 'mnemonic-import' ||
    importMethod === 'private-key-import'
  );
}

/**
 * Resolves the run token context (mint, symbol, decimals, atomic balance)
 * from the active wallet balance for a chosen stablecoin symbol. Returns null
 * when the wallet holds no matching token — payroll cannot proceed without a
 * funded, identifiable token.
 *
 * `token.balance` from the wallet balance is a UI-formatted decimal string
 * (see `dasAssetToBalanceToken`), so we convert it to atomic here.
 */
export function resolvePayrollTokenContext(
  balance: WalletBalanceResponse | null | undefined,
  symbol: string,
): PayrollTokenContext | null {
  return resolvePayrollTokenContextByIdentifier(balance, symbol);
}

function aliasesForToken(network: OffpayNetwork, mint: string, symbol: string): readonly string[] {
  const normalizedSymbol = symbol.toUpperCase();
  const supported = getUmbraSupportedTokens(network).find((token) => token.mint === mint);
  const values = [supported?.symbol, ...(supported?.aliases ?? [])].filter(
    (value): value is string => value != null && value.trim().length > 0,
  );
  return [...new Set(values.filter((value) => value.toUpperCase() !== normalizedSymbol))];
}

export function resolveKnownPayrollTokenContext(
  identifier: string,
  network: OffpayNetwork | null | undefined,
): PayrollTokenContext | null {
  if (network == null) return null;
  const normalized = identifier.trim();
  if (normalized.length === 0) return null;
  const upper = normalized.toUpperCase();

  const stablecoin = getStablecoinPolicyEntries(network).find(
    (entry) => entry.enabled && (entry.mint === normalized || entry.symbol === upper),
  );
  if (stablecoin != null) {
    return {
      mint: stablecoin.mint,
      symbol: stablecoin.symbol,
      aliases: [],
      decimals: stablecoin.decimals,
      balanceAtomic: '0',
    };
  }

  const umbraToken =
    getUmbraTokenByMint(network, normalized) ?? getUmbraTokenBySymbol(network, normalized);
  if (umbraToken == null) return null;
  return {
    mint: umbraToken.mint,
    symbol: umbraToken.symbol,
    aliases: aliasesForToken(network, umbraToken.mint, umbraToken.symbol),
    decimals: umbraToken.decimals,
    balanceAtomic: '0',
  };
}

export function buildPayrollTokenContexts(
  balance: WalletBalanceResponse | null | undefined,
): PayrollTokenContext[] {
  if (balance == null) return [];
  return balance.tokens
    .filter((token) => !token.spam && token.mint != null)
    .map((token) => {
      const decimals = typeof token.decimals === 'number' ? token.decimals : 6;
      return {
        mint: token.mint,
        symbol: token.symbol,
        aliases: aliasesForToken(balance.network, token.mint, token.symbol),
        decimals,
        balanceAtomic: decimalInputToAtomicAmount(token.balance ?? '0', decimals),
      };
    });
}

export function resolvePayrollTokenContextByIdentifier(
  balance: WalletBalanceResponse | null | undefined,
  identifier: string,
  network?: OffpayNetwork | null,
): PayrollTokenContext | null {
  const tokens = buildPayrollTokenContexts(balance);
  if (tokens.length === 0) return null;

  const normalized = identifier.trim();
  if (normalized.length === 0) return null;
  const upper = normalized.toUpperCase();

  const byMint = tokens.find((token) => token.mint === normalized);
  if (byMint != null) return byMint;

  const bySymbol = tokens.find((token) => token.symbol.toUpperCase() === upper);
  if (bySymbol != null) return bySymbol;

  if (network != null) {
    const aliasMatches = tokens.filter((token) => {
      const umbraToken = getUmbraSupportedTokens(network).find(
        (supported) => supported.mint === token.mint,
      );
      return umbraToken?.aliases?.some((alias) => alias.toUpperCase() === upper) === true;
    });
    if (aliasMatches.length === 1) return aliasMatches[0];
  }

  return null;
}
