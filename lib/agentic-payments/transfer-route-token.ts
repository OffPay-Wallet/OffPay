import { normalizeStablecoinSymbol } from '@/lib/policy/stablecoin-policy';
import { getUmbraTokenByMint, getUmbraTokenBySymbol } from '@/lib/umbra/umbra-supported-tokens';

import type { AgenticPrivateSendAction } from '@/store/agenticChatStore';
import type { WalletBalanceResponse } from '@/types/offpay-api';

export type AgenticTransferRoute = AgenticPrivateSendAction['route'];

export function routeKind(route: AgenticTransferRoute): AgenticPrivateSendAction['kind'] {
  return route === 'normal' ? 'normal_send' : 'private_send';
}

export function resolveTransferTokenForRoute(params: {
  action: Pick<AgenticPrivateSendAction, 'network' | 'tokenMint' | 'tokenSymbol'>;
  route: AgenticTransferRoute;
  balance: WalletBalanceResponse | null | undefined;
}): { ok: true; token: string } | { ok: false; message: string } {
  if (params.route === 'normal') return { ok: true, token: params.action.tokenMint };

  if (params.route === 'magicblock') {
    const umbraToken = getUmbraTokenByMint(params.action.network, params.action.tokenMint);
    const stableAlias = umbraToken?.aliases?.find((alias) => normalizeStablecoinSymbol(alias));
    return { ok: true, token: stableAlias ?? params.action.tokenMint };
  }

  const token =
    getUmbraTokenByMint(params.action.network, params.action.tokenMint) ??
    getUmbraTokenBySymbol(params.action.network, params.action.tokenSymbol);
  if (token == null || !token.mixer) {
    return {
      ok: false,
      message: 'Umbra supports USDC or USDT for this route.',
    };
  }

  const held = params.balance?.tokens.some((entry) => entry.mint === token.mint && !entry.spam);
  if (held !== true) {
    return {
      ok: false,
      message: `Umbra route needs ${token.symbol} in this wallet.`,
    };
  }

  return { ok: true, token: token.mint };
}
