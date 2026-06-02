import { useQuery } from '@tanstack/react-query';

import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import {
  getOffpayFeatureCapability,
  isOffpayFeatureAvailable,
} from '@/lib/api/offpay-capabilities';
import { mark, measure } from '@/lib/perf/perf-marks';
import { fetchUmbraVaultRegistrationStatus } from '@/lib/umbra/umbra-execution';
import { isUmbraNetworkSupported } from '@/lib/umbra/umbra-supported-tokens';
import { useWalletStore } from '@/store/walletStore';

import type { UmbraVaultRegistrationStatus } from '@/lib/umbra/umbra-execution';

const UMBRA_REGISTRATION_GC_TIME_MS = 1000 * 60 * 30;
const UMBRA_REGISTRATION_STALE_TIME_MS = 10 * 60_000;

/**
 * Fetches the on-chain Umbra vault registration status for the active wallet.
 *
 * Used by the Receive flow (and any other surface that needs to reflect
 * "already set up") so that Private P2P state persists across app restarts
 * rather than depending on in-memory mutation state.
 */
export function useUmbraVaultRegistrationStatus(options: { enabled?: boolean } = {}) {
  const enabledByCaller = options.enabled ?? true;
  const walletAddress = useWalletStore((state) => state.publicKey);
  const walletId = useWalletStore((state) => state.activeWalletId);
  const { network } = useOffpayNetwork();
  const { canUseNetwork } = useOffpayNetworkAccess();
  const { capabilities, isCapabilitiesPending } = useOffpayCapabilities({
    enabled: enabledByCaller,
  });
  const capability = getOffpayFeatureCapability(capabilities, 'umbra.execution');
  const capabilityAvailable = isOffpayFeatureAvailable(capabilities, 'umbra.execution');

  const enabled =
    walletAddress != null &&
    network != null &&
    enabledByCaller &&
    canUseNetwork &&
    isUmbraNetworkSupported(network) &&
    capabilityAvailable;

  const query = useQuery<UmbraVaultRegistrationStatus>({
    queryKey: ['offpay', 'umbraVaultRegistrationStatus', network, walletAddress] as const,
    queryFn: () => {
      if (walletAddress == null || network == null) {
        throw new Error('Umbra vault registration requires an active wallet.');
      }
      const startedAt = mark();
      return fetchUmbraVaultRegistrationStatus({
        walletAddress,
        walletId,
        network,
      }).finally(() => {
        measure('umbra.registrationStatus.query', startedAt, { network });
      });
    },
    enabled,
    // Registration only changes after explicit setup/repair paths, which
    // already invalidate this key. Keep it fresh across receive-screen
    // remounts so cached "already active" state does not keep probing
    // the on-chain registration account.
    staleTime: UMBRA_REGISTRATION_STALE_TIME_MS,
    gcTime: UMBRA_REGISTRATION_GC_TIME_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      return previousKey?.[2] === network && previousKey?.[3] === walletAddress
        ? previousData
        : undefined;
    },
    retry: false,
    meta: {
      capabilityMessage: capability.message,
    },
  });

  return {
    ...query,
    walletAddress,
    network,
    capability,
    isCapabilitiesPending: enabledByCaller && canUseNetwork && isCapabilitiesPending,
    isCapabilityEnabled: capabilityAvailable || enabled,
  };
}
