import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useRef } from 'react';

import { prefetchAiChatCredits } from '@/hooks/agentic-chat/useAiChatCredits';
import {
  fetchOffpaySwapTokensForLogos,
  offpaySwapTokensQueryKey,
  TOKEN_LOGO_CACHE_GC_MS,
  TOKEN_LOGO_CACHE_STALE_MS,
} from '@/hooks/useOffpayTokenLogoMap';
import { prefetchOffpayCapabilities } from '@/lib/api/offpay-capabilities-query';
import { useOffpayNetworkAccess } from '@/hooks/useOffpayNetworkAccess';
import { useOffpayNetwork } from '@/hooks/useOffpayNetwork';
import {
  clearOffpaySigningSession,
  setOffpayAuthRecoveryHandler,
} from '@/lib/api/offpay-api-client';
import { bootstrapOffpayRequestSecret } from '@/lib/bootstrap/offpay-bootstrap';
import { unsupportedOffpayAttestationAdapter } from '@/lib/bootstrap/attestation';
import { mark, measure } from '@/lib/perf/perf-marks';
import { scheduleUiWorkAfterFirstPaint } from '@/lib/perf/ui-work-scheduler';
import { getAgenticConversationScopeKey } from '@/store/agenticChatStore';
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
  const authStatus = useOffpayAuthStore((state) => state.status);
  const setReady = useOffpayAuthStore((state) => state.setReady);
  const setProvisioning = useOffpayAuthStore((state) => state.setProvisioning);
  const setError = useOffpayAuthStore((state) => state.setError);
  const previousIdentityRef = useRef<string | null>(null);
  const tokenLogoPrefetchKeyRef = useRef<string | null>(null);

  const identity = useMemo(() => {
    if (!canUseNetwork || network == null || walletId == null || walletAddress == null) {
      return null;
    }
    return `${network}:${walletId}:${walletAddress}`;
  }, [canUseNetwork, network, walletAddress, walletId]);
  const aiChatCreditScopeKey = useMemo(() => {
    if (!canUseNetwork || network == null || walletAddress == null) return null;
    return getAgenticConversationScopeKey({ walletAddress, network });
  }, [canUseNetwork, network, walletAddress]);

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
        void queryClient.invalidateQueries({
          predicate: ({ queryKey }) =>
            Array.isArray(queryKey) &&
            queryKey[0] === 'offpay' &&
            queryKey[1] !== 'capabilities' &&
            queryKey[1] !== 'streamCapabilities',
          refetchType: 'none',
        });
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
    if (!canUseNetwork || network == null) return;

    void prefetchOffpayCapabilities({
      queryClient,
      network,
      requestOwner: 'bootstrap.capabilities',
    });
  }, [canUseNetwork, network, queryClient]);

  useEffect(() => {
    if (authStatus !== 'ready' || !canUseNetwork || network == null || walletAddress == null) {
      return;
    }

    const prefetchKey = `${network}:${walletAddress}`;
    if (tokenLogoPrefetchKeyRef.current === prefetchKey) return;
    tokenLogoPrefetchKeyRef.current = prefetchKey;

    const startedAt = mark();
    void queryClient
      .prefetchQuery({
        queryKey: offpaySwapTokensQueryKey(network),
        queryFn: ({ signal }) =>
          fetchOffpaySwapTokensForLogos(network, signal, 'bootstrap.tokenLogos'),
        staleTime: TOKEN_LOGO_CACHE_STALE_MS,
        gcTime: TOKEN_LOGO_CACHE_GC_MS,
      })
      .then(() => {
        measure('tokenLogo.bootstrapPrefetch', startedAt, {
          network,
          status: 'ok',
        });
      })
      .catch(() => {
        if (tokenLogoPrefetchKeyRef.current === prefetchKey) {
          tokenLogoPrefetchKeyRef.current = null;
        }
        measure('tokenLogo.bootstrapPrefetch', startedAt, {
          network,
          status: 'error',
        });
      });
  }, [authStatus, canUseNetwork, network, queryClient, walletAddress]);

  useEffect(() => {
    if (aiChatCreditScopeKey == null) return;

    const controller = new AbortController();
    void prefetchAiChatCredits(aiChatCreditScopeKey, { signal: controller.signal }).catch(
      () => undefined,
    );

    return () => {
      controller.abort('bootstrap ai chat credit scope changed');
    };
  }, [aiChatCreditScopeKey]);

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

        void prefetchOffpayCapabilities({
          queryClient,
          network,
          requestOwner: 'bootstrap.capabilities.recovery',
          force: true,
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
