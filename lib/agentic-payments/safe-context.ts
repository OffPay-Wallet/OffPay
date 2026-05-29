import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { buildStablecoinMetadataLookup, buildVisibleTokenHoldings } from '@/lib/api/offpay-wallet-data';

import type { AgentSafeContext } from '@/lib/agentic-payments/types';
import type { WalletAccount } from '@/store/walletStore';
import type {
  CapabilitiesResponse,
  OffpayNetwork,
  WalletBalanceResponse,
} from '@/types/offpay-api';

const MAX_CONTEXT_TOKEN_SYMBOLS = 24;

interface BuildAgentSafeContextParams {
  walletAddress: string | null;
  accountName: string | null | undefined;
  wallets: readonly WalletAccount[];
  network: OffpayNetwork | null;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  balance: WalletBalanceResponse | null | undefined;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
}

/**
 * Build the *minimum* context the AI proxy needs to do intent extraction.
 *
 * Privacy-first contract:
 * - No wallet addresses for the active wallet or any other wallet leave the
 *   device through this object. The proxy already strips most of these in
 *   `workers/ai-proxy/src/privacy/firewall.ts:sanitizeIntentContext`, but we
 *   stop producing them here so a future code path cannot accidentally
 *   forward them.
 * - No token mints, balances, USD prices, or transaction history leak.
 * - Only token *symbols* (not contract addresses) are sent so the model
 *   can disambiguate "USDC" vs "dUSDC" when the user is typing.
 */
export function buildAgentSafeContext(params: BuildAgentSafeContextParams): AgentSafeContext {
  const capabilities = params.capabilities ?? null;
  const tokenSymbols = collectTokenSymbols(params.balance);

  return {
    network: params.network ?? undefined,
    walletMode: params.walletMode,
    capabilities: {
      networkAvailable: params.canUseNetwork,
      walletBalance: isOffpayFeatureAvailable(capabilities, 'wallet.balance'),
      normalSend: isOffpayFeatureAvailable(capabilities, 'wallet.balance'),
      privateSend:
        isOffpayFeatureAvailable(capabilities, 'payment.privateInitMint') &&
        isOffpayFeatureAvailable(capabilities, 'payment.privateSend') &&
        isOffpayFeatureAvailable(capabilities, 'payment.rpcBroadcast'),
    },
    supportedActions: ['draft_normal_send', 'draft_private_send'],
    tokenSymbols,
  };
}

/**
 * Apply Umbra-aware metadata to wallet-balance rows for *local* use only —
 * the chat screen uses this to render bubbles and the validators use it to
 * resolve symbols. Never forwarded to the AI proxy.
 */
export function buildAgentWalletBalanceResponse(
  balance: WalletBalanceResponse,
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined,
): WalletBalanceResponse {
  const metadata = buildStablecoinMetadataLookup(capabilities?.offline?.supportedStablecoins);
  const holdingsByMint = new Map(
    buildVisibleTokenHoldings(balance, undefined, metadata)
      .filter((holding) => holding.mint !== 'native-sol')
      .map((holding) => [holding.mint, holding] as const),
  );

  return {
    ...balance,
    tokens: balance.tokens.map((token) => {
      const holding = holdingsByMint.get(token.mint);
      if (holding == null) return token;

      return {
        ...token,
        name: holding.name,
        symbol: holding.symbol,
        logo: holding.logo ?? token.logo,
        verified: token.verified || holding.verified,
        spam: holding.spam,
      };
    }),
  };
}

function collectTokenSymbols(balance: WalletBalanceResponse | null | undefined): string[] {
  const symbols = new Set<string>(['SOL']);
  if (balance == null) return [...symbols];
  for (const token of balance.tokens) {
    const symbol = token.symbol.trim();
    if (symbol.length === 0 || symbol === token.mint) continue;
    symbols.add(symbol);
    if (symbols.size >= MAX_CONTEXT_TOKEN_SYMBOLS) break;
  }
  return [...symbols];
}
