import type { CapabilitiesResponse, CapabilityStatus, OffpayNetwork } from '@/types/offpay-api';
import { hasConfiguredHttpProvider, hasConfiguredWsProvider } from '@/services/rpc';
import { getStablecoinPolicyEntries } from '@/lib/policy/stablecoin-policy';
import { getUmbraSupportedTokens } from '@/lib/umbra/umbra-supported-tokens';

function available(message: string): CapabilityStatus {
  return { available: true, reason: 'available', message };
}

function unavailable(message: string): CapabilityStatus {
  return { available: false, reason: 'temporarily_unavailable', message };
}

export function getClientCapabilities(network: OffpayNetwork): CapabilitiesResponse {
  const httpReady = hasConfiguredHttpProvider(network);
  const wsReady = hasConfiguredWsProvider(network);
  const httpStatus = httpReady
    ? available('Client RPC provider is configured.')
    : unavailable('No client RPC provider is configured for this network.');
  const wsStatus = wsReady
    ? available('Client WebSocket provider is configured.')
    : unavailable('No client WebSocket provider is configured for this network.');
  const serverStatus = available('Protected server route is configured.');
  const clientStatus = available('Client-side flow is configured.');

  return {
    network,
    capabilities: {
      wallet: {
        balance: httpStatus,
        transactions: httpStatus,
      },
      stream: {
        walletActivity: wsStatus,
      },
      swap: {
        tokens: serverStatus,
        price: serverStatus,
        normalSwap: serverStatus,
        privacySwap: serverStatus,
        triggerOrders: serverStatus,
        recurringSwap: serverStatus,
      },
      payment: {
        privateInitMint: clientStatus,
        privateBalance: clientStatus,
        privateSend: clientStatus,
        umbraPrivateP2p: clientStatus,
        settle: httpStatus,
        rpcBroadcast: httpStatus,
      },
      umbra: {
        execution: getUmbraSupportedTokens(network).length > 0
          ? clientStatus
          : unavailable('Umbra is not configured for this network.'),
      },
      offline: {
        noncePool: httpStatus,
        nonceCreate: httpStatus,
        nonceAdvance: httpStatus,
        nonceStatus: httpStatus,
        tokenContext: httpStatus,
        rentEstimate: httpStatus,
        supportedStablecoins: getStablecoinPolicyEntries(network),
      },
    },
  };
}
