import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { fetchUmbraEncryptedBalances } from '@/lib/umbra/umbra-execution';
import {
  getUmbraSupportedTokens,
  isUmbraNetworkSupported,
} from '@/lib/umbra/umbra-supported-tokens';

import {
  errorCodeFromUnknown,
  hydrateStringArg,
  isExplicitUmbraReadRequest,
  isNetworkReady,
  readStringArg,
  requireWalletAndNetwork,
} from './helpers';
import type { AgenticToolDefinition } from './types';

const MAX_UMBRA_BALANCE_TOKENS = 4;

function readTokenList(call: Parameters<AgenticToolDefinition['run']>[0]): string[] {
  const args = call.args ?? {};
  const rawTokens = args.tokens;
  if (Array.isArray(rawTokens)) {
    return rawTokens.filter((value): value is string => typeof value === 'string');
  }
  const token = readStringArg(call, 'token');
  if (token != null && token.length > 0) return [token];
  return [];
}

export const getUmbraBalancesTool: AgenticToolDefinition = {
  name: 'get_umbra_balances',
  schema: {
    name: 'get_umbra_balances',
    description:
      'Explicit Umbra-only read. Returns encrypted Umbra balance summaries for supported tokens. No encrypted account addresses or mints are returned.',
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Optional token symbol.' },
        tokens: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional token symbols. Capped at four.',
        },
      },
    },
  },
  run: async (call, context) => {
    const scope = requireWalletAndNetwork({
      walletAddress: context.scope.walletAddress,
      network: context.scope.network,
    });
    if (!scope.ok) return { error: { code: scope.code } };
    if (!isExplicitUmbraReadRequest(context.userText)) {
      return { error: { code: 'requires_explicit_umbra_balance_request' } };
    }
    if (!isNetworkReady(context)) return { error: { code: 'network_unavailable' } };
    if (context.walletId == null) return { error: { code: 'wallet_locked' } };
    if (!isUmbraNetworkSupported(scope.network)) return { error: { code: 'feature_unavailable' } };
    if (context.capabilities == null) return { result: { status: 'loading' } };
    if (!isOffpayFeatureAvailable(context.capabilities, 'umbra.execution')) {
      return { error: { code: 'feature_unavailable' } };
    }

    const requested = readTokenList(call)
      .map((token) => hydrateStringArg({ ...call, args: { token } }, 'token', context.redactions))
      .filter((token) => token.trim().length > 0);
    const defaultTokens = getUmbraSupportedTokens(scope.network).map((token) => token.symbol);
    const tokens = (requested.length > 0 ? requested : defaultTokens).slice(
      0,
      MAX_UMBRA_BALANCE_TOKENS,
    );
    if (tokens.length === 0) return { error: { code: 'token_missing' } };

    try {
      const result = await fetchUmbraEncryptedBalances({
        walletAddress: scope.walletAddress,
        walletId: context.walletId,
        network: scope.network,
        tokens,
      });
      return {
        result: {
          status: 'ok',
          vaultState: result.vaultState ?? null,
          vaultRegistered: result.vaultRegistered ?? null,
          vaultCanShield: result.vaultCanShield ?? null,
          mixerRegistered: result.mixerRegistered ?? null,
          balances: (result.balances ?? []).map((balance) => ({
            symbol: balance.symbol,
            name: balance.name,
            state: balance.state,
            displayBalance: balance.displayBalance,
            unreadableReason: balance.unreadableReason ?? null,
            encryptionKeyStatus: balance.encryptionKeyStatus ?? null,
          })),
          truncated: requested.length > MAX_UMBRA_BALANCE_TOKENS,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'umbra_balance_failed') } };
    }
  },
};
