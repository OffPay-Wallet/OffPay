import {
  STREAM_DEFAULTS,
} from './helius.js';
import { getSupportedStablecoins, type SupportedStablecoin } from './offline.js';
import { hasConfiguredRpcHttp } from './solana-rpc-providers.js';
import type { Bindings, Network } from './types.js';
import { getUmbraCircuitMetadata, getUmbraIndexerUrl, getUmbraRelayerUrl } from './umbra.js';
import { isValidSolanaAddress } from './validation.js';

type CapabilityReason =
  | 'available'
  | 'unsupported_network'
  | 'temporarily_unavailable'
  | 'not_implemented';

interface CapabilityStatus {
  available: boolean;
  reason: CapabilityReason;
  message: string;
}

interface CapabilitiesResponse {
  network: Network;
  capabilities: {
    wallet: {
      balance: CapabilityStatus;
      transactions: CapabilityStatus;
    };
    risk: {
      score: CapabilityStatus;
    };
    stream: {
      walletActivity: CapabilityStatus;
    };
    swap: {
      tokens: CapabilityStatus;
      price: CapabilityStatus;
      normalSwap: CapabilityStatus;
      privacySwap: CapabilityStatus;
      triggerOrders: CapabilityStatus;
      recurringSwap: CapabilityStatus;
    };
    rwa: {
      assets: CapabilityStatus;
      price: CapabilityStatus;
      quote: CapabilityStatus;
      execute: CapabilityStatus;
      magicBlockIntent: CapabilityStatus;
      magicBlockTransfer: CapabilityStatus;
    };
    payment: {
      privateInitMint: CapabilityStatus;
      privateBalance: CapabilityStatus;
      privateSend: CapabilityStatus;
      umbraPrivateP2p: CapabilityStatus;
      settle: CapabilityStatus;
      rpcBroadcast: CapabilityStatus;
    };
    offline: {
      noncePool: CapabilityStatus;
      nonceCreate: CapabilityStatus;
      nonceAdvance: CapabilityStatus;
      nonceStatus: CapabilityStatus;
      tokenContext: CapabilityStatus;
      rentEstimate: CapabilityStatus;
      supportedStablecoins: SupportedStablecoin[];
    };
    umbra: {
      execution: CapabilityStatus;
      indexer: CapabilityStatus;
      relayer: CapabilityStatus;
      circuitVersion: string;
      minSdkVersion: string;
      indexerEndpoint: string;
      relayerEndpoint: string;
    };
    privacy: {
      shieldedBalance: CapabilityStatus;
      scanAnnouncements: CapabilityStatus;
      registerViewingKey: CapabilityStatus;
    };
  };
}

function available(message: string): CapabilityStatus {
  return {
    available: true,
    reason: 'available',
    message,
  };
}

function unsupportedNetwork(message: string): CapabilityStatus {
  return {
    available: false,
    reason: 'unsupported_network',
    message,
  };
}

function notImplemented(message: string): CapabilityStatus {
  return {
    available: false,
    reason: 'not_implemented',
    message,
  };
}

function hasConfiguredBinding(bindings: Bindings, key: keyof Bindings): boolean {
  const value = bindings[key];
  return typeof value === 'string' && value.trim().length > 0;
}

function hasTruthyBinding(bindings: Bindings, key: keyof Bindings): boolean {
  const value = bindings[key];
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function hasConfiguredValidatorList(bindings: Bindings, key: keyof Bindings): boolean {
  const value = bindings[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }

  const validators = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return validators.length > 0 && validators.every((validator) => isValidSolanaAddress(validator));
}

function hasConfiguredMintAllowlist(bindings: Bindings, key: keyof Bindings): boolean {
  const value = bindings[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }

  const mints = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return mints.length > 0 && mints.every((mint) => isValidSolanaAddress(mint));
}

function hasConfiguredSolanaAddress(bindings: Bindings, key: keyof Bindings): boolean {
  const value = bindings[key];
  return typeof value === 'string' && isValidSolanaAddress(value.trim());
}

function hasWalletRpcNetworkConfig(bindings: Bindings, network: Network): boolean {
  return hasConfiguredRpcHttp(bindings, network);
}

function hasRiskProviderNetworkConfig(bindings: Bindings, network: Network): boolean {
  return network === 'mainnet'
    ? hasConfiguredBinding(bindings, 'HELIUS_MAINNET_API_KEY')
    : hasConfiguredBinding(bindings, 'HELIUS_DEVNET_API_KEY');
}

function hasMagicBlockNetworkConfig(bindings: Bindings, network: Network): boolean {
  return network === 'mainnet'
    ? hasConfiguredValidatorList(bindings, 'MAGICBLOCK_MAINNET_VALIDATORS')
    : hasConfiguredValidatorList(bindings, 'MAGICBLOCK_DEVNET_VALIDATORS');
}

function hasRwaMagicBlockRouterConfig(bindings: Bindings, network: Network): boolean {
  const key =
    network === 'mainnet'
      ? 'OFFPAY_RWA_MAGICBLOCK_ROUTER_MAINNET_URL'
      : 'OFFPAY_RWA_MAGICBLOCK_ROUTER_DEVNET_URL';
  return hasConfiguredBinding(bindings, key);
}

function isRwaDelegateEnabled(bindings: Bindings, network: Network): boolean {
  return network === 'mainnet'
    ? hasTruthyBinding(bindings, 'OFFPAY_RWA_DELEGATE_MAINNET_ENABLED')
    : hasTruthyBinding(bindings, 'OFFPAY_RWA_DELEGATE_DEVNET_ENABLED');
}

function buildRwaMagicBlockIntentCapability(
  network: Network,
  configured: boolean,
): CapabilityStatus {
  if (network === 'mainnet') {
    return configured
      ? available('MagicBlock delegated RWA intent accounts are enabled on mainnet.')
      : notImplemented(
        'Mainnet MagicBlock RWA intents require OFFPAY_RWA_DELEGATE_PROGRAM_ID, OFFPAY_RWA_DELEGATE_MAINNET_ENABLED=1, MagicBlock validator config, and router config after audit.',
      );
  }

  return configured
    ? available('MagicBlock delegated RWA intent accounts are enabled on devnet.')
    : notImplemented(
      'Devnet MagicBlock RWA intents require OFFPAY_RWA_DELEGATE_PROGRAM_ID, OFFPAY_RWA_DELEGATE_DEVNET_ENABLED=1, MagicBlock validator config, and router config.',
    );
}

function buildMainnetOnlyCapability(
  network: Network,
  configured: boolean,
  availableMessage: string,
  unsupportedMessage: string,
  notImplementedMessage: string,
): CapabilityStatus {
  if (network !== 'mainnet') {
    return unsupportedNetwork(unsupportedMessage);
  }

  return configured ? available(availableMessage) : notImplemented(notImplementedMessage);
}

async function getCapabilities(
  bindings: Bindings,
  network: Network,
): Promise<CapabilitiesResponse> {
  const walletRpcConfigured = hasWalletRpcNetworkConfig(bindings, network);
  const riskProviderConfigured = hasRiskProviderNetworkConfig(bindings, network);
  const jupiterConfigured = hasConfiguredBinding(bindings, 'JUPITER_API_KEY');
  const rwaAllowlistConfigured = hasConfiguredMintAllowlist(
    bindings,
    'OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST',
  );
  const rwaMainnetEnabled = hasTruthyBinding(bindings, 'OFFPAY_RWA_MAINNET_ENABLED');
  const magicBlockConfigured = hasMagicBlockNetworkConfig(bindings, network);
  const rwaDelegateProgramConfigured = hasConfiguredSolanaAddress(
    bindings,
    'OFFPAY_RWA_DELEGATE_PROGRAM_ID',
  );
  const rwaDelegateConfigured =
    rwaDelegateProgramConfigured &&
    magicBlockConfigured &&
    hasRwaMagicBlockRouterConfig(bindings, network) &&
    isRwaDelegateEnabled(bindings, network);
  const umbraLocalTestMode = hasTruthyBinding(bindings, 'UMBRA_LOCAL_TEST_MODE');
  const umbraCircuitMetadata = getUmbraCircuitMetadata(bindings);
  const umbraIndexerEndpoint = getUmbraIndexerUrl(bindings, network);
  const umbraRelayerEndpoint = getUmbraRelayerUrl(bindings, network);
  const umbraExecutionAvailable = umbraLocalTestMode || (
    umbraIndexerEndpoint.length > 0 &&
    umbraRelayerEndpoint.length > 0
  );
  const umbraMetadataAvailable = umbraExecutionAvailable;
  const supportedStablecoins = getSupportedStablecoins(bindings, network);
  const hasEnabledStablecoin = supportedStablecoins.some((stablecoin) => stablecoin.enabled);
  const walletActivity =
    !walletRpcConfigured
      ? notImplemented('Live wallet activity streaming is not enabled for this network in this deployment.')
      : STREAM_DEFAULTS[network].walletActivity
        ? available('Live wallet activity streaming is available for this network.')
        : unsupportedNetwork('Live wallet activity streaming is not supported on this network.');

  return {
    network,
    capabilities: {
      wallet: {
        balance: walletRpcConfigured
          ? available('Wallet balances are available on this network.')
          : notImplemented('Wallet balances are not enabled for this network in this deployment.'),
        transactions: walletRpcConfigured
          ? available('Wallet transactions are available on this network.')
          : notImplemented('Wallet transactions are not enabled for this network in this deployment.'),
      },
      risk: {
        score: riskProviderConfigured && walletRpcConfigured
          ? available('Risk scoring is available on this network.')
          : notImplemented('Risk scoring is not enabled for this network in this deployment.'),
      },
      stream: {
        walletActivity,
      },
      swap: {
        tokens: jupiterConfigured
          ? available('Verified-only swap token discovery is available on this network.')
          : notImplemented('Swap token discovery is not enabled for this deployment.'),
        price: jupiterConfigured
          ? available('Swap price lookups are available on this network.')
          : notImplemented('Swap price lookups are not enabled for this deployment.'),
        normalSwap: buildMainnetOnlyCapability(
          network,
          jupiterConfigured,
          'This swap flow is available on mainnet.',
          'This swap flow is currently available only on mainnet.',
          'This swap flow is not enabled for this deployment.',
        ),
        privacySwap: buildMainnetOnlyCapability(
          network,
          jupiterConfigured && magicBlockConfigured,
          'Privacy swap mode is available on mainnet.',
          'Privacy swap mode depends on Jupiter order/execute and is currently available only on mainnet.',
          'Privacy swap mode is not enabled for this deployment.',
        ),
        triggerOrders: buildMainnetOnlyCapability(
          network,
          jupiterConfigured,
          'Trigger orders are available on mainnet.',
          'Trigger orders are currently available only on mainnet.',
          'Trigger orders are not enabled for this deployment.',
        ),
        recurringSwap: buildMainnetOnlyCapability(
          network,
          jupiterConfigured,
          'Recurring swaps are available on mainnet.',
          'Recurring swaps are currently available only on mainnet.',
          'Recurring swaps are not enabled for this deployment.',
        ),
      },
      rwa: {
        assets: buildMainnetOnlyCapability(
          network,
          jupiterConfigured && rwaAllowlistConfigured,
          'Jupiter verified stocks catalog is available on mainnet.',
          'Real RWA secondary-market catalog is currently available only on mainnet.',
          'RWA catalog requires JUPITER_API_KEY and OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST.',
        ),
        price: buildMainnetOnlyCapability(
          network,
          jupiterConfigured && rwaAllowlistConfigured,
          'Jupiter RWA pricing is available on mainnet.',
          'Real RWA pricing is currently available only on mainnet.',
          'RWA pricing requires JUPITER_API_KEY and OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST.',
        ),
        quote: buildMainnetOnlyCapability(
          network,
          jupiterConfigured && rwaAllowlistConfigured && rwaMainnetEnabled,
          'Jupiter RWA secondary-market quote creation is enabled on mainnet.',
          'RWA secondary-market quotes are currently available only on mainnet.',
          'RWA quote creation requires JUPITER_API_KEY, OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST, and OFFPAY_RWA_MAINNET_ENABLED=1.',
        ),
        execute: buildMainnetOnlyCapability(
          network,
          jupiterConfigured && rwaAllowlistConfigured && rwaMainnetEnabled && walletRpcConfigured,
          'Signed Jupiter RWA swap transactions can be submitted on mainnet.',
          'RWA secondary-market execution is currently available only on mainnet.',
          'RWA execution requires JUPITER_API_KEY, OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST, OFFPAY_RWA_MAINNET_ENABLED=1, and mainnet RPC configuration.',
        ),
        magicBlockIntent: buildRwaMagicBlockIntentCapability(network, rwaDelegateConfigured),
        magicBlockTransfer: notImplemented(
          'Direct MagicBlock RWA token transfers remain disabled; ER is only used for OffPay-owned delegated intent accounts, while Jupiter and Token-2022 settlement stay on base Solana.',
        ),
      },
      payment: {
        privateInitMint: magicBlockConfigured && hasEnabledStablecoin
          ? available('Private payment mint initialization is currently enabled on this network.')
          : notImplemented('Private payment mint initialization is not enabled for this network in this deployment.'),
        privateBalance: magicBlockConfigured && hasEnabledStablecoin
          ? available('Private payment balance lookup is currently enabled on this network.')
          : notImplemented('Private payment balance lookup is not enabled for this network in this deployment.'),
        privateSend: magicBlockConfigured && hasEnabledStablecoin
          ? available('Private payment send is currently enabled on this network.')
          : notImplemented('Private payment send is not enabled for this network in this deployment.'),
        umbraPrivateP2p: walletRpcConfigured && umbraExecutionAvailable
          ? available(
            umbraLocalTestMode
              ? 'Umbra private P2P route is available in local bridge test mode.'
              : 'Umbra private P2P route is available on this network.',
          )
          : notImplemented('Umbra private P2P route is not enabled for this network in this deployment.'),
        settle: walletRpcConfigured
          ? available('Offline settlement is currently enabled on this network.')
          : notImplemented('Offline settlement is not enabled for this network in this deployment.'),
        rpcBroadcast: walletRpcConfigured
          ? available('Raw transaction broadcast fallback is currently enabled on this network.')
          : notImplemented('Raw transaction broadcast fallback is not enabled for this network in this deployment.'),
      },
      offline: {
        noncePool: walletRpcConfigured
          ? available('Offline payment slot pool preparation and status are enabled on this network.')
          : notImplemented('Offline payment slot pool routes are not enabled for this network in this deployment.'),
        nonceCreate: walletRpcConfigured
          ? available('Offline payment slot creation preparation is enabled on this network.')
          : notImplemented('Offline payment slot creation preparation is not enabled for this network in this deployment.'),
        nonceAdvance: walletRpcConfigured
          ? available('Offline payment slot nonce advance preparation is enabled on this network.')
          : notImplemented('Offline payment slot nonce advance preparation is not enabled for this network in this deployment.'),
        nonceStatus: walletRpcConfigured
          ? available('Offline payment slot status refresh is enabled on this network.')
          : notImplemented('Offline payment slot status refresh is not enabled for this network in this deployment.'),
        tokenContext: walletRpcConfigured && hasEnabledStablecoin
          ? available('Offline USDC/USDT token context is enabled on this network.')
          : notImplemented('Offline token context is not enabled for this network in this deployment.'),
        rentEstimate: walletRpcConfigured
          ? available('Offline payment slot rent estimation is enabled on this network.')
          : notImplemented('Offline payment slot rent estimation is not enabled for this network in this deployment.'),
        supportedStablecoins,
      },
      umbra: {
        execution: walletRpcConfigured && umbraExecutionAvailable
          ? available(
            umbraLocalTestMode
              ? 'Umbra execution provider proxies are available in local bridge test mode.'
              : 'Umbra execution provider proxies are available on this network through the configured indexer and relayer.',
          )
          : notImplemented('Umbra execution provider proxies are not enabled for this network in this deployment.'),
        indexer: umbraExecutionAvailable
          ? available(
            umbraLocalTestMode
              ? 'Umbra indexer is available in local bridge test mode.'
              : 'Umbra indexer is configured for this network.',
          )
          : notImplemented('Umbra indexer is not configured for this network in this deployment.'),
        relayer: umbraExecutionAvailable
          ? available(
            umbraLocalTestMode
              ? 'Umbra relayer is available in local bridge test mode.'
              : 'Umbra relayer is configured for this network.',
          )
          : notImplemented('Umbra relayer is not configured for this network in this deployment.'),
        circuitVersion: umbraCircuitMetadata.circuitVersion,
        minSdkVersion: umbraCircuitMetadata.minSdkVersion,
        indexerEndpoint: umbraIndexerEndpoint,
        relayerEndpoint: umbraRelayerEndpoint,
      },
      privacy: {
        shieldedBalance: umbraMetadataAvailable
          ? available(
            umbraLocalTestMode
              ? 'Umbra shielded-balance metadata is available in local bridge test mode.'
              : 'Umbra shielded-balance metadata is available on this network.',
          )
          : notImplemented('Umbra shielded-balance metadata is not enabled for this deployment.'),
        scanAnnouncements: umbraMetadataAvailable
          ? available(
            umbraLocalTestMode
              ? 'Umbra announcement scanning is available in local bridge test mode.'
              : 'Umbra announcement scanning is available on this network.',
          )
          : notImplemented('Umbra announcement scanning is not enabled for this deployment.'),
        registerViewingKey: umbraMetadataAvailable
          ? available(
            umbraLocalTestMode
              ? 'Umbra viewing-key registration is available in local bridge test mode.'
              : 'Umbra viewing-key registration is available on this network.',
          )
          : notImplemented('Umbra viewing-key registration is not enabled for this deployment.'),
      },
    },
  };
}

export {
  getCapabilities,
  type CapabilityReason,
  type CapabilityStatus,
  type CapabilitiesResponse,
};
