import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { isKnownStablecoinMint } from '@/lib/policy/stablecoin-policy';
import { getUmbraTokenByMint, isUmbraNetworkSupported } from '@/lib/umbra/umbra-supported-tokens';

import type { PayrollRouteFacts } from '@/lib/payroll/payroll-route-readiness';
import type { CapabilitiesResponse, OffpayNetwork } from '@/types/offpay-api';

/**
 * Inputs that must be gathered asynchronously / from the platform by the
 * caller (a hook). Kept separate from capability flags so this composer
 * stays synchronous and unit-testable.
 */
export interface PayrollReadinessInputs {
  network: OffpayNetwork;
  mint: string;
  capabilities: CapabilitiesResponse['capabilities'] | null;
  walletCanSign: boolean;
  online: boolean;
  rpcReady: boolean;
  /** Run total fits available token balance. */
  hasTokenBalanceForRun: boolean;
  /** Enough SOL for fees across the batch. */
  hasFeeSol: boolean;
  /** Result of `isRnZkProverNativeModuleAvailable()` (platform-specific). */
  umbraNativeProverAvailable: boolean;
  /** Umbra vault fee account readiness probe result. */
  umbraVaultFeeReady: boolean;
  /** Mainnet sender mixer registration (`vaultRegistrationStatus.mixerRegistered`). */
  umbraSenderMixerRegistered: boolean;
}

/**
 * Composes the pure `PayrollRouteFacts` from live capability flags, platform
 * prover availability, and gathered balance/RPC/vault probes. The route
 * evaluator (`payroll-route-readiness`) consumes the result.
 */
export function buildPayrollRouteFacts(inputs: PayrollReadinessInputs): PayrollRouteFacts {
  const capabilitiesLoaded = inputs.capabilities != null;
  const tokenSupported = isKnownStablecoinMint(inputs.network, inputs.mint);
  const umbraTokenSupported =
    isUmbraNetworkSupported(inputs.network) &&
    getUmbraTokenByMint(inputs.network, inputs.mint) != null;

  const umbraCapabilityAvailable =
    isOffpayFeatureAvailable(inputs.capabilities, 'umbra.execution') &&
    isOffpayFeatureAvailable(inputs.capabilities, 'payment.umbraPrivateP2p') &&
    isOffpayFeatureAvailable(inputs.capabilities, 'payment.rpcBroadcast');

  const magicblockCapabilityAvailable =
    isOffpayFeatureAvailable(inputs.capabilities, 'payment.privateInitMint') &&
    isOffpayFeatureAvailable(inputs.capabilities, 'payment.privateSend') &&
    isOffpayFeatureAvailable(inputs.capabilities, 'payment.rpcBroadcast');

  return {
    network: inputs.network,
    walletCanSign: inputs.walletCanSign,
    online: inputs.online,
    rpcReady: inputs.rpcReady,
    capabilitiesLoaded,
    tokenSupported,
    hasTokenBalanceForRun: inputs.hasTokenBalanceForRun,
    hasFeeSol: inputs.hasFeeSol,

    umbraNativeProverAvailable: inputs.umbraNativeProverAvailable,
    umbraCapabilityAvailable,
    umbraVaultFeeReady: inputs.umbraVaultFeeReady,
    umbraTokenSupported,
    umbraSenderMixerRegistered: inputs.umbraSenderMixerRegistered,

    magicblockCapabilityAvailable,
    magicblockValidatorConfigured: magicblockCapabilityAvailable,
    magicblockTokenSupported: tokenSupported,
  };
}
