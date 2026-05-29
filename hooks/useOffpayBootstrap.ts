import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { offpayCapabilitiesQueryKey } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import {
  bootstrapOffpayRequestSecret,
  hasOffpayBootstrapCredentials,
} from '@/lib/bootstrap/offpay-bootstrap';
import { useOffpayAuthStore } from '@/store/offpayAuthStore';
import { useWalletStore } from '@/store/walletStore';

import type { OffpayAttestationAdapter } from '@/lib/bootstrap/attestation';

interface UseOffpayBootstrapOptions {
  attestationAdapter?: OffpayAttestationAdapter;
}

interface EnsureBootstrapOptions {
  force?: boolean;
}

export function useOffpayBootstrap(options?: UseOffpayBootstrapOptions) {
  const queryClient = useQueryClient();
  const { network, unsupportedReason } = useOffpayNetwork();
  const { canUseNetwork } = useOffpayNetworkAccess();
  const walletId = useWalletStore((state) => state.activeWalletId);
  const walletAddress = useWalletStore((state) => state.publicKey);
  const authStatus = useOffpayAuthStore((state) => state.status);
  const authError = useOffpayAuthStore((state) => state.error);
  const setChecking = useOffpayAuthStore((state) => state.setChecking);
  const setProvisioning = useOffpayAuthStore((state) => state.setProvisioning);
  const setReady = useOffpayAuthStore((state) => state.setReady);
  const setBlocked = useOffpayAuthStore((state) => state.setBlocked);
  const setError = useOffpayAuthStore((state) => state.setError);

  const mutation = useMutation({
    mutationFn: async (ensureOptions?: EnsureBootstrapOptions) => {
      if (network == null) {
        const message = unsupportedReason ?? 'This network is not supported by OffPay API.';
        setBlocked(message);
        throw new Error(message);
      }

      if (!canUseNetwork) {
        const message = 'Offline mode is active. Go online before bootstrapping OffPay API access.';
        setBlocked(message);
        throw new Error(message);
      }

      if (walletId == null || walletAddress == null) {
        const message = 'A wallet is required before OffPay API bootstrap.';
        setBlocked(message);
        throw new Error(message);
      }

      setChecking();
      const hasCredentials = await hasOffpayBootstrapCredentials(walletAddress);
      if (!hasCredentials || ensureOptions?.force === true) {
        setProvisioning();
      }

      const result = await bootstrapOffpayRequestSecret({
        walletAddress,
        walletId,
        force: ensureOptions?.force,
        attestationAdapter: options?.attestationAdapter,
      });

      setReady({
        bootstrapVersion: result.bootstrapVersion,
        provisionedAt: result.issuedAt,
      });

      await queryClient.invalidateQueries({
        queryKey: offpayCapabilitiesQueryKey(network),
      });

      return result;
    },
    onError: (error: unknown) => {
      setError(error instanceof Error ? error.message : 'OffPay bootstrap failed.');
    },
  });

  const ensureBootstrap = useCallback(
    (ensureOptions?: EnsureBootstrapOptions) => mutation.mutateAsync(ensureOptions),
    [mutation],
  );

  return {
    ensureBootstrap,
    isBootstrapping: mutation.isPending,
    bootstrapResult: mutation.data,
    bootstrapError: mutation.error,
    authStatus,
    authError,
    network,
    unsupportedReason,
  };
}
