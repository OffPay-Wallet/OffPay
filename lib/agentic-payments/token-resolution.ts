import { isSupportedStablecoinToken } from '@/lib/policy/stablecoin-policy';
import { getUmbraTokenByMint } from '@/lib/umbra/umbra-supported-tokens';
import { normalizeStablecoinRequest } from '@/lib/agentic-payments/private-send-intent';

import type { OffpayNetwork, WalletBalanceResponse } from '@/types/offpay-api';

type BalanceToken = WalletBalanceResponse['tokens'][number];

export type AgenticTokenResolution =
  | {
      ok: true;
      token: BalanceToken;
    }
  | {
      ok: false;
      message: string;
    };

interface ResolveAgenticBalanceTokenParams {
  balance: WalletBalanceResponse;
  network: OffpayNetwork;
  tokenText: string;
}

function normalizeTokenReference(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function getTokenAliases(network: OffpayNetwork, token: BalanceToken): string[] {
  const aliases = getUmbraTokenByMint(network, token.mint)?.aliases ?? [];
  return aliases.filter((alias) => alias.trim().length > 0);
}

function uniqueTokens(tokens: BalanceToken[]): BalanceToken[] {
  const seen = new Set<string>();
  const unique: BalanceToken[] = [];
  for (const token of tokens) {
    if (seen.has(token.mint)) continue;
    seen.add(token.mint);
    unique.push(token);
  }
  return unique;
}

function formatAmbiguousToken(token: BalanceToken): string {
  const label =
    token.name.trim().length > 0 && token.name !== token.symbol
      ? `${token.symbol} (${token.name})`
      : token.symbol;
  return `${label} - balance ${token.balance} - CA ${token.mint}`;
}

function ambiguityMessage(tokenText: string, tokens: BalanceToken[]): string {
  const options = tokens.map(formatAmbiguousToken).join('\n');
  return `I found multiple tokens matching ${tokenText}. Please choose one by ticker or CA:\n${options}`;
}

export function resolveAgenticBalanceToken({
  balance,
  network,
  tokenText,
}: ResolveAgenticBalanceTokenParams): AgenticTokenResolution {
  const requested = tokenText.trim();
  if (requested.length === 0) {
    return { ok: false, message: 'Tell me which token to send.' };
  }

  // 1. Exact mint match always wins.
  const mintMatch = balance.tokens.find((candidate) => candidate.mint === requested);
  if (mintMatch != null) {
    return { ok: true, token: mintMatch };
  }

  const normalized = normalizeTokenReference(requested);
  const stablecoinRequest = normalizeStablecoinRequest(requested);
  const exactSymbolMatches = balance.tokens.filter(
    (candidate) => normalizeTokenReference(candidate.symbol) === normalized,
  );
  const exactNameMatches = balance.tokens.filter(
    (candidate) => normalizeTokenReference(candidate.name) === normalized,
  );
  const aliasMatches = balance.tokens.filter((candidate) =>
    getTokenAliases(network, candidate).some(
      (alias) => normalizeTokenReference(alias) === normalized,
    ),
  );
  const stablecoinMatches =
    stablecoinRequest == null
      ? []
      : balance.tokens.filter((candidate) => {
          const aliases = getTokenAliases(network, candidate);
          return (
            normalizeTokenReference(candidate.symbol) === stablecoinRequest ||
            aliases.some((alias) => normalizeTokenReference(alias) === stablecoinRequest) ||
            isSupportedStablecoinToken({
              network,
              token: candidate.mint,
              symbol: stablecoinRequest,
            })
          );
        });

  // 2. Exact symbol match. A user typing "USDC" means the token whose
  // symbol is literally "USDC". This must trump alias/stablecoin matches —
  // otherwise an alias entry on a different mint (for example dUSDC with
  // alias "USDC") creates a false ambiguity.
  if (exactSymbolMatches.length === 1) {
    return { ok: true, token: exactSymbolMatches[0] };
  }
  if (exactSymbolMatches.length > 1) {
    return { ok: false, message: ambiguityMessage(requested, exactSymbolMatches) };
  }

  // 3. Exact name match. Same precedence rule as symbol.
  if (exactNameMatches.length === 1) {
    return { ok: true, token: exactNameMatches[0] };
  }
  if (exactNameMatches.length > 1) {
    return { ok: false, message: ambiguityMessage(requested, exactNameMatches) };
  }

  // 4. Alias and stablecoin-policy fallbacks. These are looser and may
  // legitimately match more than one token — that's where the ambiguity
  // prompt belongs.
  const fallback = uniqueTokens([...aliasMatches, ...stablecoinMatches]);
  if (fallback.length === 0) {
    return { ok: false, message: `I could not find ${requested} in this wallet balance.` };
  }
  if (fallback.length === 1) {
    return { ok: true, token: fallback[0] };
  }

  return { ok: false, message: ambiguityMessage(requested, fallback) };
}
