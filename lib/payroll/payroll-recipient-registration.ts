import { fetchUmbraRegistrationStatusForAddresses } from '@/lib/umbra/umbra-execution';
import { isAbortError, throwIfAborted } from '@/lib/perf/abort';

import type { OffpayNetwork } from '@/types/offpay-api';

/**
 * Caps on recipient Umbra-registration probing. A payroll run can hold up to
 * 5,000 rows; probing every unique recipient's on-chain Umbra registration
 * would be thousands of account reads. We probe up to `PROBE_CAP` unique
 * recipients; anything beyond the cap (or any failed probe) defaults to "not
 * registered" so routing stays conservative and the UI never blocks on a huge
 * fan-out.
 */
export const PAYROLL_RECIPIENT_PROBE_CAP = 200;

export interface RecipientRegistrationResult {
  /** recipient address -> true when Umbra mixer-registered. */
  registeredByAddress: Record<string, boolean>;
  /** Recipients that were not probed (over cap) — treated as not registered. */
  unprobed: string[];
  probedCount: number;
}

export interface ProbeRecipientRegistrationParams {
  recipients: readonly string[];
  network: OffpayNetwork;
  /**
   * The ACTIVE wallet address. It signs/owns the read-only runtime; recipient
   * addresses are queried against it. Required because Umbra registration
   * lookups for non-owned addresses must use the sender's runtime.
   */
  signerWalletAddress: string;
  walletId: string | null;
  /** Recipients to skip (e.g. the sender's own address / self-payments). */
  skip?: ReadonlySet<string>;
  signal?: AbortSignal;
  /** Optional shared cache so repeated stagings reuse prior probes. */
  cache?: Map<string, boolean>;
}

function registrationCacheKey(network: OffpayNetwork, address: string): string {
  return `${network}:${address}`;
}

/**
 * Probes Umbra mixer registration for a deduplicated, capped set of
 * recipients using the SENDER's read-only runtime (so non-owned recipient
 * addresses can be looked up). Yields cached entries first, then performs a
 * single batched lookup for the rest.
 */
export async function probeRecipientRegistration(
  params: ProbeRecipientRegistrationParams,
): Promise<RecipientRegistrationResult> {
  const registeredByAddress: Record<string, boolean> = {};
  const skip = params.skip ?? new Set<string>();

  // Deduplicate, drop skipped recipients, and serve from cache up front.
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const recipient of params.recipients) {
    if (skip.has(recipient) || seen.has(recipient)) continue;
    seen.add(recipient);

    const cached = params.cache?.get(registrationCacheKey(params.network, recipient));
    if (cached != null) {
      registeredByAddress[recipient] = cached;
      continue;
    }
    unique.push(recipient);
  }

  const toProbe = unique.slice(0, PAYROLL_RECIPIENT_PROBE_CAP);
  const unprobed = unique.slice(PAYROLL_RECIPIENT_PROBE_CAP);
  for (const address of unprobed) registeredByAddress[address] = false;

  throwIfAborted(params.signal);

  if (toProbe.length > 0) {
    let statuses: Awaited<ReturnType<typeof fetchUmbraRegistrationStatusForAddresses>>;
    try {
      statuses = await fetchUmbraRegistrationStatusForAddresses({
        signerWalletAddress: params.signerWalletAddress,
        walletId: params.walletId,
        lookupAddresses: toProbe,
        network: params.network,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      for (const address of toProbe) registeredByAddress[address] = false;
      return {
        registeredByAddress,
        unprobed,
        probedCount: toProbe.length,
      };
    }

    throwIfAborted(params.signal);

    for (const address of toProbe) {
      // A missing/failed status is treated as "not registered" — conservative,
      // never routes an unverified recipient through Umbra.
      const registered = statuses[address]?.mixerRegistered === true;
      registeredByAddress[address] = registered;
      params.cache?.set(registrationCacheKey(params.network, address), registered);
    }
  }

  return {
    registeredByAddress,
    unprobed,
    probedCount: toProbe.length,
  };
}
