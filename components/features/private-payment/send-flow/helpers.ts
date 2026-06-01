/**
 * Pure helpers for the private-payment send flow.
 *
 * Co-located inside `components/features/private-payment/send-flow/` so
 * the helpers can import `SendTokenOption` from `./types` directly,
 * without dragging the type up into a neutral `types/` layer or
 * recreating the lib→components layering issue we just resolved for
 * the swap helpers.
 *
 * Scope:
 *   - Pure functions only. No React hooks, no JSX, no side effects.
 *   - Constants used by the pure helpers (`NATIVE_SOL_MINT`,
 *     `NATIVE_SOL_SEND_MINT`).
 *
 * Out of scope (kept inside `PrivatePaymentSendFlow.tsx`):
 *   - Reanimated step-transition helpers — they wrap react-native
 *     animation builders and the file already pays for that import.
 *   - `runAfterLoadingPaint` — small `requestAnimationFrame` wrapper
 *     used only by the submission orchestrator; doesn't gain anything
 *     from extraction.
 *   - Header / button sub-components — they depend on the screen's
 *     local `styles` and layout constants. Extracting them without
 *     moving styles would just churn imports.
 */
import { formatLamportsAsSol, type TokenLogoLookup } from '@/lib/api/offpay-wallet-data';
import { isSupportedStablecoinToken } from '@/lib/policy/stablecoin-policy';
import { getUmbraTokenByMint } from '@/lib/umbra/umbra-supported-tokens';

import type { ProcessResultVariant } from '@/components/ui/ProcessResultScreen';
import type { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import type { OfflineSupportedStablecoin, WalletBalanceResponse } from '@/types/offpay-api';

import type { SendTokenOption } from './types';

/**
 * Solana's wrapped-SOL mint. Recognized by external scan flows
 * (e.g. QR code recipients with `mint=<NATIVE_SOL_MINT>`) so the
 * send flow can route them to the same SOL row regardless of which
 * convention the QR uses.
 */
export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Sentinel mint used inside the send flow's local token list to
 * distinguish "send native SOL via SystemProgram transfer" from
 * "send wrapped-SOL SPL". The native row never carries the real
 * wrapped-SOL mint to avoid accidentally routing native sends
 * through the SPL transfer path.
 */
export const NATIVE_SOL_SEND_MINT = 'native-sol';

/**
 * Send-token option as produced by `getStablecoinOptions`. Re-uses
 * `SendTokenOption` so callers don't need to import a parallel type.
 */
export type StablecoinOption = SendTokenOption;

export function parseDisplayBalance(value: string): number {
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeTokenDecimals(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 18 ? value : 6;
}

export function normalizeTokenSymbol(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Match an externally-supplied mint string (e.g. from a deep-link
 * route param) against an in-app `SendTokenOption`. Falls back to
 * the wrapped-SOL ↔ native-SOL equivalence so a QR that lists the
 * canonical mint maps to the local native-SOL sentinel row.
 */
export function routeMintMatchesToken(requestedMint: string, token: SendTokenOption): boolean {
  if (requestedMint.length === 0) return false;
  if (token.mint === requestedMint) return true;

  return requestedMint === NATIVE_SOL_MINT && token.mint === NATIVE_SOL_SEND_MINT;
}

/**
 * Resolve the best logo URL for a token, preferring the API-provided
 * logo and falling back to cached lookups by mint, then by symbol.
 */
export function resolveCachedTokenLogo(params: {
  mint: string;
  symbol: string;
  apiLogo: string | null;
  logos: TokenLogoLookup;
}): string | null {
  const apiLogo = params.apiLogo?.trim();
  if (apiLogo) return apiLogo;

  return (
    params.logos.byMint?.get(params.mint) ??
    params.logos.bySymbol?.get(normalizeTokenSymbol(params.symbol)) ??
    null
  );
}

/**
 * Build the list of tokens shown to the user in the send flow's
 * token-select step. Combines wallet balance, capability-driven
 * stablecoin policy, and Umbra mixer support to produce a single
 * ranked list with private-route hints.
 *
 * `includeNormalTokens` lets offline mode hide non-stablecoin rows
 * (offline payments only support whitelisted stablecoins) while
 * online mode shows the full list including native SOL and any
 * other tokens the user holds.
 */
export function getStablecoinOptions(
  balance: WalletBalanceResponse | undefined,
  network: ReturnType<typeof useOffpayNetwork>['network'],
  supportedStablecoins: readonly OfflineSupportedStablecoin[] | null | undefined,
  logos: TokenLogoLookup,
  includeNormalTokens: boolean,
): StablecoinOption[] {
  if (balance == null || network == null) return [];

  const supportedByMint = new Map(
    (supportedStablecoins ?? [])
      .filter((stablecoin) => stablecoin.enabled)
      .map((stablecoin) => [stablecoin.mint, stablecoin] as const),
  );

  const tokenOptions = balance.tokens
    .filter((token) => {
      if (token.spam) return false;
      if (parseDisplayBalance(token.balance) <= 0) return false;
      if (supportedByMint.has(token.mint)) return true;
      if (
        isSupportedStablecoinToken({
          network,
          token: token.mint,
          symbol: token.symbol,
        })
      ) {
        return true;
      }
      return includeNormalTokens;
    })
    .map((token) => {
      const stablecoin = supportedByMint.get(token.mint);
      const umbraToken = getUmbraTokenByMint(network, token.mint);
      const displaySymbol = stablecoin?.symbol ?? umbraToken?.symbol ?? token.symbol;
      const displayName = stablecoin?.name ?? umbraToken?.name ?? token.name;
      const magicBlockPrivateSupported =
        stablecoin != null ||
        isSupportedStablecoinToken({
          network,
          token: token.mint,
          symbol: token.symbol,
        });
      const umbraPrivateSupported = umbraToken?.mixer === true;
      const privateSupported = magicBlockPrivateSupported || umbraPrivateSupported;

      return {
        mint: token.mint,
        name: displayName,
        symbol: displaySymbol,
        logo: resolveCachedTokenLogo({
          mint: token.mint,
          symbol: displaySymbol,
          apiLogo: umbraToken?.logoUri ?? token.logo,
          logos,
        }),
        balance: token.balance,
        decimals: normalizeTokenDecimals(
          stablecoin?.decimals ?? umbraToken?.decimals ?? token.decimals,
        ),
        verified: token.verified || stablecoin != null || umbraToken != null,
        privateSupported,
      };
    })
    .sort((left, right) => {
      return left.symbol.localeCompare(right.symbol);
    });

  if (!includeNormalTokens || balance.solBalance <= 0) {
    return tokenOptions;
  }

  return [
    {
      mint: NATIVE_SOL_SEND_MINT,
      name: 'Solana',
      symbol: 'SOL',
      logo: resolveCachedTokenLogo({
        mint: NATIVE_SOL_MINT,
        symbol: 'SOL',
        apiLogo: null,
        logos,
      }),
      balance: formatLamportsAsSol(balance.solBalance, 9),
      decimals: 9,
      verified: true,
      privateSupported: false,
    },
    ...tokenOptions,
  ].sort((left, right) => {
    return left.symbol.localeCompare(right.symbol);
  });
}

export function isPositiveRawAmount(value: string | null): value is string {
  if (value == null || !/^\d+$/.test(value)) return false;
  return BigInt(value) > 0n;
}

export function isMagicBlockPrivateToken(
  network: ReturnType<typeof useOffpayNetwork>['network'],
  token: SendTokenOption | null,
): boolean {
  if (network == null || token == null) return false;
  return isSupportedStablecoinToken({
    network,
    token: token.mint,
    symbol: token.symbol,
  });
}

export function isUmbraPrivateP2PToken(
  network: ReturnType<typeof useOffpayNetwork>['network'],
  token: SendTokenOption | null,
): boolean {
  if (network == null || token == null) return false;
  return getUmbraTokenByMint(network, token.mint)?.mixer === true;
}

export function isAmountWithinBalance(
  amountRaw: string | null,
  balanceRaw: string | null,
): boolean {
  if (!isPositiveRawAmount(amountRaw) || balanceRaw == null || !/^\d+$/.test(balanceRaw)) {
    return false;
  }

  return BigInt(amountRaw) <= BigInt(balanceRaw);
}

export function getMutationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to send payment.';
}

/**
 * Classify a send-flow failure into a user-facing process-result
 * shape. Centralized here so the same classification logic produces
 * consistent UX whether the failure came from offline, normal, or
 * private payment paths.
 */
export function classifySendFailure(error: unknown): {
  variant: ProcessResultVariant;
  title: string;
  message: string;
  statusLabel: string;
} {
  const errorMessage = getMutationErrorMessage(error);

  if (
    /user rejected|rejected by user|user denied|cancelled|canceled|user cancel/i.test(errorMessage)
  ) {
    return {
      variant: 'cancelled',
      title: 'Send cancelled',
      message: 'No transaction was signed or submitted.',
      statusLabel: 'Cancelled',
    };
  }

  if (
    /insufficient.*(sol|fund|lamport|fee|rent)|network fee|fee payer|gas|rent/i.test(errorMessage)
  ) {
    return {
      variant: 'error',
      title: 'Add SOL for fees',
      message: errorMessage,
      statusLabel: 'Fee failure',
    };
  }

  if (/set up umbra private p2p|recipient has not set up umbra private p2p/i.test(errorMessage)) {
    return {
      variant: 'error',
      title: 'Private P2P setup required',
      message: errorMessage,
      statusLabel: 'Setup required',
    };
  }

  if (/network|timeout|failed to fetch|temporarily unavailable|rpc|blockhash/i.test(errorMessage)) {
    return {
      variant: 'error',
      title: 'Network issue',
      message: errorMessage,
      statusLabel: 'Network failed',
    };
  }

  if (
    /private payment (transaction|response)|magicblock|requested token mint|requested amount|active wallet/i.test(
      errorMessage,
    )
  ) {
    return {
      variant: 'error',
      title: 'Private route verification failed',
      message: errorMessage,
      statusLabel: 'Verification failed',
    };
  }

  return {
    variant: 'error',
    title: 'Send failed',
    message: errorMessage,
    statusLabel: 'Failed',
  };
}

export function buildExplorerUrl(
  signature: string,
  network: NonNullable<ReturnType<typeof useOffpayNetwork>['network']>,
): string {
  const cluster = network === 'devnet' ? '?cluster=devnet' : '';
  return `https://solscan.io/tx/${signature}${cluster}`;
}

/**
 * Race a send operation against a wall-clock timeout. Used by the
 * private send paths because their underlying mutations can stall
 * on slow RPC providers without surfacing a clear failure to the
 * user.
 *
 * Note: this is a best-effort timeout — the underlying `operation`
 * promise may still settle after `timeoutMs`. Callers should treat
 * `withSendTimeout`'s rejection as authoritative for UI purposes,
 * but should not assume the network operation itself was cancelled.
 */
export async function withSendTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
  }
}
