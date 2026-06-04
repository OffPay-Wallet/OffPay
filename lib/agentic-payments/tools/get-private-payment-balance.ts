import { getPrivatePaymentBalance } from '@/lib/api/offpay-api-client';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { resolveAgenticBalanceToken } from '@/lib/agentic-payments/token-resolution';
import { formatAtomicAmount } from '@/lib/policy/token-amounts';

import {
  errorCodeFromUnknown,
  hydrateStringArg,
  isExplicitMagicBlockPrivateBalanceRequest,
  isNetworkReady,
  requireWalletAndNetwork,
  validatorErrorCode,
} from './helpers';
import type { AgenticToolDefinition } from './types';

export const getPrivatePaymentBalanceTool: AgenticToolDefinition = {
  name: 'get_private_payment_balance',
  schema: {
    name: 'get_private_payment_balance',
    description:
      'Returns MagicBlock private-payment balance summary for the active wallet. This is not the generic private/encrypted/Umbra vault balance tool. No wallet address or mint is returned.',
    parameters: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'Optional token symbol or redacted mint placeholder.',
        },
      },
    },
  },
  run: async (call, context) => {
    if (!isExplicitMagicBlockPrivateBalanceRequest(context.userText)) {
      return { error: { code: 'use_umbra_vault_balance' } };
    }

    const scope = requireWalletAndNetwork({
      walletAddress: context.scope.walletAddress,
      network: context.scope.network,
    });
    if (!scope.ok) return { error: { code: scope.code } };
    if (!isNetworkReady(context)) return { error: { code: 'network_unavailable' } };
    if (context.capabilities == null) return { result: { status: 'loading' } };
    if (!isOffpayFeatureAvailable(context.capabilities, 'payment.privateBalance')) {
      return { error: { code: 'feature_unavailable' } };
    }

    const tokenText = hydrateStringArg(call, 'token', context.redactions);
    let mint: string | undefined;
    let tokenSymbol: string | null = null;
    let decimals: number | null = null;
    if (tokenText.length > 0) {
      if (context.balance == null) return { result: { status: 'loading' } };
      const resolution = resolveAgenticBalanceToken({
        balance: context.balance,
        network: scope.network,
        tokenText,
      });
      if (!resolution.ok) return { error: { code: validatorErrorCode(resolution.message) } };
      mint = resolution.token.mint;
      tokenSymbol = resolution.token.symbol;
      decimals = resolution.token.decimals;
    }

    try {
      const response = await getPrivatePaymentBalance(scope.walletAddress, scope.network, mint);
      const responseToken =
        context.balance?.tokens.find((token) => token.mint === response.mint) ?? null;
      const responseDecimals = response.decimals ?? decimals ?? responseToken?.decimals ?? null;
      const responseSymbol = response.symbol ?? tokenSymbol ?? responseToken?.symbol ?? null;
      const publicBalance =
        responseDecimals == null
          ? response.baseBalance
          : formatAtomicAmount(response.baseBalance, responseDecimals);
      const privateBalance =
        responseDecimals == null
          ? response.privateBalance
          : formatAtomicAmount(response.privateBalance, responseDecimals);

      return {
        result: {
          status: 'ok',
          route: 'magicblock',
          routeLabel: 'MagicBlock private-payment balance',
          network: scope.network,
          symbol: responseSymbol,
          publicBalance,
          privateBalance,
          privateBalanceIsZero: response.privateBalance === '0',
          decimals: responseDecimals ?? null,
        },
      };
    } catch (error) {
      return { error: { code: errorCodeFromUnknown(error, 'private_balance_failed') } };
    }
  },
};
