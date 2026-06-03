import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';

import { EMPTY_PARAMS } from './helpers';
import type { AgenticToolDefinition } from './types';

export const checkPrivateSendReadyTool: AgenticToolDefinition = {
  name: 'check_private_send_ready',
  schema: {
    name: 'check_private_send_ready',
    description:
      'Compatibility readiness tool. Returns whether MagicBlock and Umbra private routes are currently usable on the active network.',
    parameters: EMPTY_PARAMS,
  },
  run: (_call, context) => {
    const capabilities = context.capabilities ?? null;
    const magicblock =
      isOffpayFeatureAvailable(capabilities, 'payment.privateInitMint') &&
      isOffpayFeatureAvailable(capabilities, 'payment.privateSend') &&
      isOffpayFeatureAvailable(capabilities, 'payment.rpcBroadcast');
    const umbra =
      isOffpayFeatureAvailable(capabilities, 'umbra.execution') &&
      isOffpayFeatureAvailable(capabilities, 'payment.umbraPrivateP2p') &&
      isOffpayFeatureAvailable(capabilities, 'payment.rpcBroadcast');

    return {
      result: {
        status: 'ok',
        ready: magicblock || umbra,
        routes: {
          magicblock,
          umbra,
        },
        network: context.scope.network ?? null,
        walletMode: context.walletMode,
        canUseNetwork: context.canUseNetwork,
      },
    };
  },
};
