import { fetchUmbraVaultRegistrationStatus } from '@/lib/umbra/umbra-execution';
import { isUmbraNetworkSupported } from '@/lib/umbra/umbra-supported-tokens';
import { verifyOffpayUmbraVaultFeeAccountReadiness } from '@/lib/umbra/umbra-offpay-providers';
import { yieldToUi } from '@/lib/perf/ui-work-scheduler';
import { createAbortError } from '@/lib/perf/abort';

import type { OffpayNetwork } from '@/types/offpay-api';

/**
 * Minimum SOL (lamports) kept as a fee buffer for a payroll run. Sequential
 * private sends each pay a network fee; this is a coarse floor, refined by
 * the provider at submit time.
 */
export const PAYROLL_MIN_FEE_LAMPORTS = 2_000_000; // ~0.002 SOL

export interface PayrollRunReadiness {
  /** Sender is Umbra mixer-registered (required on mainnet to send P2P). */
  umbraSenderMixerRegistered: boolean;
  /** Umbra vault fee accounts are deployed/ready for this mint+network. */
  umbraVaultFeeReady: boolean;
  /** Wallet holds enough SOL for the fee buffer. */
  hasFeeSol: boolean;
}

export interface GatherPayrollRunReadinessParams {
  walletAddress: string;
  walletId: string | null;
  network: OffpayNetwork;
  mint: string;
  /** Active wallet SOL balance in lamports. */
  solLamports: number;
  /** Skip the (network) Umbra probes when Umbra cannot be used at all. */
  umbraEligible: boolean;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw createAbortError('Payroll readiness gathering was cancelled.');
  }
}

/**
 * Resolves run-level readiness facts that require network probes: sender
 * Umbra mixer registration and Umbra vault-fee account readiness, plus the
 * synchronous SOL fee-buffer check. Replaces the previous hard-coded
 * placeholders so route assignment reflects real on-chain state.
 *
 * When `umbraEligible` is false (e.g. no native prover, Umbra capability off,
 * or unsupported network/token) the Umbra probes are skipped — they would
 * never change the MagicBlock-only outcome and we avoid the RPC cost.
 */
export async function gatherPayrollRunReadiness(
  params: GatherPayrollRunReadinessParams,
): Promise<PayrollRunReadiness> {
  const hasFeeSol = params.solLamports >= PAYROLL_MIN_FEE_LAMPORTS;

  if (!params.umbraEligible || !isUmbraNetworkSupported(params.network)) {
    return { umbraSenderMixerRegistered: false, umbraVaultFeeReady: false, hasFeeSol };
  }

  throwIfAborted(params.signal);

  const [registration, vaultFee] = await Promise.all([
    fetchUmbraVaultRegistrationStatus({
      walletAddress: params.walletAddress,
      walletId: params.walletId,
      network: params.network,
    }).catch(() => null),
    verifyOffpayUmbraVaultFeeAccountReadiness({
      action: 'privateP2pFromPublic',
      mint: params.mint,
      network: params.network,
    }).catch(() => null),
  ]);

  await yieldToUi();
  throwIfAborted(params.signal);

  return {
    umbraSenderMixerRegistered: registration?.mixerRegistered === true,
    umbraVaultFeeReady: vaultFee?.available === true,
    hasFeeSol,
  };
}
