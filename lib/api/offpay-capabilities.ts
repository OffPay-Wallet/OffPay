import type { CapabilitiesResponse, CapabilityStatus } from '@/types/offpay-api';

export type OffpayFeature =
  | 'wallet.balance'
  | 'wallet.transactions'
  | 'stream.walletActivity'
  | 'swap.tokens'
  | 'swap.price'
  | 'swap.normalSwap'
  | 'swap.privacySwap'
  | 'swap.triggerOrders'
  | 'swap.recurringSwap'
  | 'payment.privateInitMint'
  | 'payment.privateBalance'
  | 'payment.privateSend'
  | 'payment.umbraPrivateP2p'
  | 'payment.settle'
  | 'payment.rpcBroadcast'
  | 'umbra.execution'
  | 'offline.noncePool'
  | 'offline.nonceCreate'
  | 'offline.nonceAdvance'
  | 'offline.nonceStatus'
  | 'offline.tokenContext'
  | 'offline.rentEstimate';

const CAPABILITY_PENDING: CapabilityStatus = {
  available: false,
  reason: 'temporarily_unavailable',
  message: 'Capabilities have not loaded yet.',
};

const CAPABILITY_NOT_IMPLEMENTED: CapabilityStatus = {
  available: false,
  reason: 'not_implemented',
  message: 'This feature is not available from the OffPay backend yet.',
};

type CapabilitySelector = (capabilities: CapabilitiesResponse['capabilities']) => CapabilityStatus;

const OFFPAY_FEATURE_SELECTORS: Record<OffpayFeature, CapabilitySelector> = {
  'wallet.balance': (capabilities) => capabilities.wallet.balance,
  'wallet.transactions': (capabilities) => capabilities.wallet.transactions,
  'stream.walletActivity': (capabilities) => capabilities.stream.walletActivity,
  'swap.tokens': (capabilities) => capabilities.swap.tokens,
  'swap.price': (capabilities) => capabilities.swap.price,
  'swap.normalSwap': (capabilities) => capabilities.swap.normalSwap,
  'swap.privacySwap': (capabilities) => capabilities.swap.privacySwap,
  'swap.triggerOrders': (capabilities) => capabilities.swap.triggerOrders,
  'swap.recurringSwap': (capabilities) => capabilities.swap.recurringSwap,
  'payment.privateInitMint': (capabilities) => capabilities.payment.privateInitMint,
  'payment.privateBalance': (capabilities) => capabilities.payment.privateBalance,
  'payment.privateSend': (capabilities) => capabilities.payment.privateSend,
  'payment.umbraPrivateP2p': (capabilities) =>
    capabilities.payment.umbraPrivateP2p ?? CAPABILITY_NOT_IMPLEMENTED,
  'payment.settle': (capabilities) => capabilities.payment.settle,
  'payment.rpcBroadcast': (capabilities) => capabilities.payment.rpcBroadcast,
  'umbra.execution': (capabilities) => capabilities.umbra?.execution ?? CAPABILITY_NOT_IMPLEMENTED,
  'offline.noncePool': (capabilities) => capabilities.offline?.noncePool ?? CAPABILITY_NOT_IMPLEMENTED,
  'offline.nonceCreate': (capabilities) =>
    capabilities.offline?.nonceCreate ?? CAPABILITY_NOT_IMPLEMENTED,
  'offline.nonceAdvance': (capabilities) =>
    capabilities.offline?.nonceAdvance ?? CAPABILITY_NOT_IMPLEMENTED,
  'offline.nonceStatus': (capabilities) =>
    capabilities.offline?.nonceStatus ?? CAPABILITY_NOT_IMPLEMENTED,
  'offline.tokenContext': (capabilities) =>
    capabilities.offline?.tokenContext ?? CAPABILITY_NOT_IMPLEMENTED,
  'offline.rentEstimate': (capabilities) =>
    capabilities.offline?.rentEstimate ?? CAPABILITY_NOT_IMPLEMENTED,
};

export function selectCapability(
  capabilities: CapabilitiesResponse['capabilities'] | null,
  selector: CapabilitySelector,
): CapabilityStatus {
  if (capabilities == null) return CAPABILITY_PENDING;
  return selector(capabilities);
}

export function getOffpayFeatureCapability(
  capabilities: CapabilitiesResponse['capabilities'] | null,
  feature: OffpayFeature,
): CapabilityStatus {
  return selectCapability(capabilities, OFFPAY_FEATURE_SELECTORS[feature]);
}

export function isOffpayFeatureAvailable(
  capabilities: CapabilitiesResponse['capabilities'] | null,
  feature: OffpayFeature,
): boolean {
  const status = getOffpayFeatureCapability(capabilities, feature);
  return status.available && status.reason === 'available';
}
