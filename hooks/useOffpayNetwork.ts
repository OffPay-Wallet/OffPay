import { toOffpayNetwork } from '@/constants/networks';
import { usePreferencesStore } from '@/store/preferencesStore';

import type { OffpayNetwork } from '@/types/offpay-api';

interface OffpayNetworkState {
  network: OffpayNetwork | null;
  unsupportedReason: string | null;
}

export function useOffpayNetwork(): OffpayNetworkState {
  const solanaNetwork = usePreferencesStore((state) => state.network);

  try {
    return {
      network: toOffpayNetwork(solanaNetwork),
      unsupportedReason: null,
    };
  } catch (error) {
    return {
      network: null,
      unsupportedReason:
        error instanceof Error ? error.message : 'This network is not supported by OffPay API.',
    };
  }
}
