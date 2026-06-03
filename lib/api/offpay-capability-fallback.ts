import type { CapabilitiesResponse, CapabilityStatus, OffpayNetwork } from '@/types/offpay-api';

export const CAPABILITIES_FAST_TIMEOUT_MS = 2500;
export const CAPABILITIES_STALE_TIME_MS = 1000 * 60 * 10;
export const CAPABILITIES_GC_TIME_MS = 1000 * 60 * 30;

function unavailable(message: string): CapabilityStatus {
  return {
    available: false,
    reason: 'temporarily_unavailable',
    message,
  };
}

export function buildUnavailableCapabilities(
  network: OffpayNetwork,
  message = 'OffPay API capabilities are temporarily unavailable.',
): CapabilitiesResponse {
  const status = unavailable(message);

  return {
    network,
    capabilities: {
      wallet: {
        balance: status,
        transactions: status,
      },
      stream: {
        walletActivity: status,
      },
      swap: {
        tokens: status,
        price: status,
        normalSwap: status,
        privacySwap: status,
        triggerOrders: status,
        recurringSwap: status,
      },
      payment: {
        privateInitMint: status,
        privateBalance: status,
        privateSend: status,
        umbraPrivateP2p: status,
        settle: status,
        rpcBroadcast: status,
      },
      umbra: {
        execution: status,
      },
      offline: {
        noncePool: status,
        nonceCreate: status,
        nonceAdvance: status,
        nonceStatus: status,
        tokenContext: status,
        rentEstimate: status,
        supportedStablecoins: [],
      },
    },
  };
}
