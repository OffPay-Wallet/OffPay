import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { getWalletSigningBlocker, walletCanSignWithApp } from '@/lib/wallet/wallet-capabilities';

import { EMPTY_PARAMS } from './helpers';
import type { AgenticToolDefinition } from './types';

function capabilityResult(
  available: boolean,
  reason: string | null | undefined,
): {
  available: boolean;
  reason: string | null;
} {
  return { available, reason: reason ?? null };
}

export const getClientCapabilitiesTool: AgenticToolDefinition = {
  name: 'get_client_capabilities',
  schema: {
    name: 'get_client_capabilities',
    description:
      'Returns local OffPay capability flags for the active network. No wallet addresses, balances, or history.',
    parameters: EMPTY_PARAMS,
  },
  run: (_call, context) => {
    const capabilities = context.capabilities ?? null;
    if (context.scope.network == null) return { error: { code: 'network_not_selected' } };
    if (capabilities == null) return { result: { status: 'loading' } };
    const umbraVaultBalanceAvailable = isOffpayFeatureAvailable(capabilities, 'umbra.execution');
    const activeWalletCanUseUmbra = walletCanSignWithApp({
      importMethod: context.walletImportMethod,
      walletAddress: context.scope.walletAddress,
    });
    const signingBlocker = getWalletSigningBlocker(
      context.walletImportMethod,
      'Umbra',
      context.scope.walletAddress,
    );

    return {
      result: {
        status: 'ok',
        network: context.scope.network,
        walletMode: context.walletMode,
        canUseNetwork: context.canUseNetwork,
        features: {
          walletBalance: capabilityResult(
            isOffpayFeatureAvailable(capabilities, 'wallet.balance'),
            capabilities.wallet.balance.reason,
          ),
          walletHistory: capabilityResult(
            isOffpayFeatureAvailable(capabilities, 'wallet.transactions'),
            capabilities.wallet.transactions.reason,
          ),
          normalSend: capabilityResult(
            isOffpayFeatureAvailable(capabilities, 'wallet.balance'),
            capabilities.wallet.balance.reason,
          ),
          magicblockPrivateSend: capabilityResult(
            isOffpayFeatureAvailable(capabilities, 'payment.privateInitMint') &&
              isOffpayFeatureAvailable(capabilities, 'payment.privateSend') &&
              isOffpayFeatureAvailable(capabilities, 'payment.rpcBroadcast'),
            capabilities.payment.privateSend.reason,
          ),
          privateBalance: capabilityResult(
            activeWalletCanUseUmbra && umbraVaultBalanceAvailable,
            signingBlocker ?? capabilities.umbra?.execution?.reason,
          ),
          umbraVaultBalance: capabilityResult(
            activeWalletCanUseUmbra && umbraVaultBalanceAvailable,
            signingBlocker ?? capabilities.umbra?.execution?.reason,
          ),
          magicblockPrivatePaymentBalance: capabilityResult(
            isOffpayFeatureAvailable(capabilities, 'payment.privateBalance'),
            capabilities.payment.privateBalance.reason,
          ),
          umbraPrivateP2p: capabilityResult(
            activeWalletCanUseUmbra &&
              isOffpayFeatureAvailable(capabilities, 'umbra.execution') &&
              isOffpayFeatureAvailable(capabilities, 'payment.umbraPrivateP2p') &&
              isOffpayFeatureAvailable(capabilities, 'payment.rpcBroadcast'),
            signingBlocker ??
              capabilities.payment.umbraPrivateP2p?.reason ??
              capabilities.umbra?.execution?.reason,
          ),
          swap: capabilityResult(
            isOffpayFeatureAvailable(capabilities, 'swap.normalSwap'),
            capabilities.swap.normalSwap.reason,
          ),
          privacySwap: capabilityResult(
            isOffpayFeatureAvailable(capabilities, 'swap.privacySwap'),
            capabilities.swap.privacySwap.reason,
          ),
        },
      },
    };
  },
};
