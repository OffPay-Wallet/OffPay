import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useRef } from 'react';

import { offpayCapabilitiesQueryKey } from '@/hooks/useOffpayCapabilities';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import {
  clearOffpaySigningSession,
  setOffpayAuthRecoveryHandler,
} from '@/lib/api/offpay-api-client';
import { bootstrapOffpayRequestSecret } from '@/lib/bootstrap/offpay-bootstrap';
import { unsupportedOffpayAttestationAdapter } from '@/lib/bootstrap/attestation';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import { useOffpayAuthStore } from '@/store/offpayAuthStore';
import { useOffpayLaunchStore } from '@/store/offpayLaunchStore';
import { useWalletStore } from '@/store/walletStore';

import type { OffpayAttestationAdapter } from '@/lib/bootstrap/attestation';

interface OffpayBootstrapProviderProps {
  children: React.ReactNode;
  attestationAdapter?: OffpayAttestationAdapter;
}

export function OffpayBootstrapProvider({
  children,
  attestationAdapter = unsupportedOffpayAttestationAdapter,
}: OffpayBootstrapProviderProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const { network } = useOffpayNetwork();
  const { canUseNetwork } = useOffpayNetworkAccess();
  const walletId = useWalletStore((state) => state.activeWalletId);
  const walletAddress = useWalletStore((state) => state.publicKey);
  const resetAuthState = useOffpayAuthStore((state) => state.reset);
  const setReady = useOffpayAuthStore((state) => state.setReady);
  const setProvisioning = useOffpayAuthStore((state) => state.setProvisioning);
  const setError = useOffpayAuthStore((state) => state.setError);
  const previousIdentityRef = useRef<string | null>(null);

  const identity = useMemo(() => {
    if (!canUseNetwork || network == null || walletId == null || walletAddress == null) {
      return null;
    }
    return `${network}:${walletId}:${walletAddress}`;
  }, [canUseNetwork, network, walletAddress, walletId]);

  useEffect(() => {
    if (identity == null) return undefined;

    const previousIdentity = previousIdentityRef.current;
    if (previousIdentity === identity) return;

    previousIdentityRef.current = identity;
    if (previousIdentity == null) return;

    clearOffpaySigningSession();
    resetAuthState();
    useOffpayLaunchStore.getState().reset();

    const scheduledReset = scheduleUiWorkAfterFirstPaint(
      () => {
        void queryClient.invalidateQueries({ queryKey: ['offpay'], refetchType: 'none' });
      },
      {
        timeoutMs: 4500,
        fallbackDelayMs: 900,
      },
    );

    return () => {
      scheduledReset.cancel();
    };
  }, [identity, queryClient, resetAuthState]);

  useEffect(() => {
    if (!canUseNetwork || network == null || walletId == null || walletAddress == null) {
      setOffpayAuthRecoveryHandler(null);
      return undefined;
    }

    setOffpayAuthRecoveryHandler(async () => {
      setProvisioning();
      try {
        const result = await bootstrapOffpayRequestSecret({
          walletAddress,
          walletId,
          force: true,
          attestationAdapter,
        });

        setReady({
          bootstrapVersion: result.bootstrapVersion,
          provisionedAt: result.issuedAt,
        });

        await queryClient.invalidateQueries({
          queryKey: offpayCapabilitiesQueryKey(network),
        });
      } catch (error: unknown) {
        setError(error instanceof Error ? error.message : 'OffPay bootstrap failed.');
        throw error;
      }
    });

    return () => {
      setOffpayAuthRecoveryHandler(null);
    };
  }, [
    attestationAdapter,
    canUseNetwork,
    network,
    queryClient,
    setError,
    setProvisioning,
    setReady,
    walletAddress,
    walletId,
  ]);

  return <>{children}</>;
}
