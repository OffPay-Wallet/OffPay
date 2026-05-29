import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import {
  offpayWalletBalanceQueryKey,
  offpayWalletTransactionsBaseQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import { decimalInputToAtomicAmount, formatAtomicAmount } from '@/lib/policy/token-amounts';

import type { OffpayNetwork } from '@/types/offpay-api';
import type { WalletBalanceResponse } from '@/types/offpay-api';

/**
 * Centralized post-Umbra-action cache invalidator.
 *
 * After a shield / withdraw / claim / setup action lands on-chain we
 * need to refresh more than just the encrypted balance:
 *
 *   - Public wallet balance (token has been moved into / out of the
 *     vault, the wallet's public token balance must update).
 *   - Wallet transactions list (the new on-chain tx should appear in
 *     history).
 *   - Encrypted-balance query (the shielded total updates after the
 *     Arcium MPC callback finalises).
 *   - Token valuations (USD value of holdings shifts when balances
 *     change).
 *
 * Provider/indexer views can lag finalization, so a single
 * `invalidateQueries` immediately after success may return the same
 * stale snapshot. We schedule a retry-curve at 5 s / 15 s / 30 s /
 * 60 s to catch up with upstream state without spamming it.
 *
 * The hook tracks scheduled timers in a ref so a fresh action cancels
 * any prior schedule, and unmount cleans them up.
 */

interface ScheduleParams {
  walletAddress: string | null;
  network: OffpayNetwork | null;
}

const POST_ACTION_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000] as const;

export function useUmbraCacheInvalidator() {
  const queryClient = useQueryClient();
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const cancelPending = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
  }, []);

  // Cancel any in-flight schedule on unmount so we don't trigger
  // refetches against a stale screen.
  useEffect(() => {
    return cancelPending;
  }, [cancelPending]);

  const runOnce = useCallback(
    ({ walletAddress, network }: ScheduleParams) => {
      if (walletAddress == null || network == null) return;

      void queryClient.invalidateQueries({
        queryKey: offpayWalletBalanceQueryKey(walletAddress, network),
        refetchType: 'active',
      });
      void queryClient.invalidateQueries({
        queryKey: offpayWalletTransactionsBaseQueryKey(walletAddress, network),
        // History is usually not mounted when a shield / claim runs.
        // Refetch inactive activity queries too so the next History
        // open is not pinned to the old page set.
        refetchType: 'all',
      });
      void queryClient.invalidateQueries({
        // Invalidate every encrypted-balance scope (token-set keyed).
        // Using the prefix matcher keeps this callback agnostic to
        // which token list the caller queried with.
        queryKey: ['offpay', 'umbraEncryptedBalances', network, walletAddress] as const,
        // Claims often happen from Receive while the Shielded tab is
        // inactive. Refetch cached inactive vault queries too so the
        // next tab open is not pinned to the old zero balance.
        refetchType: 'all',
      });
      // Vault registration status (mixer + vault setup bits). Bust
      // it after every Umbra action so a fresh setup or shield
      // surfaces the latest registration state without waiting on
      // the 5-min stale-time.
      void queryClient.invalidateQueries({
        queryKey: ['offpay', 'umbraVaultRegistrationStatus', network, walletAddress] as const,
        refetchType: 'active',
      });
      // Token valuations / portfolio totals depend on the wallet
      // balance shape; bust them so the home card shows fresh fiat
      // values without waiting on stale-time.
      void queryClient.invalidateQueries({
        queryKey: ['offpay', 'tokenValuations'] as const,
        refetchType: 'active',
      });
      void queryClient.invalidateQueries({
        queryKey: ['offpay', 'portfolioValuation'] as const,
        refetchType: 'active',
      });
    },
    [queryClient],
  );

  /**
   * Run an immediate invalidation, then schedule retry-polls on a
   * backoff curve to defeat the 30 s upstream wallet-balance cache.
   *
   * Returns a cancel function in case the caller needs to abort the
   * schedule (e.g. user navigates away from the screen).
   */
  const scheduleRefresh = useCallback(
    (params: ScheduleParams) => {
      cancelPending();
      runOnce(params);

      for (const delay of POST_ACTION_RETRY_DELAYS_MS) {
        const handle = setTimeout(() => {
          runOnce(params);
        }, delay);
        timersRef.current.push(handle);
      }

      return cancelPending;
    },
    [cancelPending, runOnce],
  );

  /**
   * Optimistic update for shield: deduct `atomicAmount` from the
   * public token balance immediately so the UI shows the new value
   * without waiting on provider/indexer catch-up. The retry-poll schedule
   * will overwrite this with the authoritative on-chain value once
   * the cache clears.
   */
  const applyOptimisticShield = useCallback(
    (params: ScheduleParams & { mint: string; atomicAmount: string }) => {
      const { walletAddress, network, mint, atomicAmount } = params;
      if (walletAddress == null || network == null) return;
      const key = offpayWalletBalanceQueryKey(walletAddress, network);
      const existing = queryClient.getQueryData<WalletBalanceResponse>(key);
      if (existing == null) return;
      const delta = safeBigInt(atomicAmount);
      if (delta == null || delta <= 0n) return;

      const tokens = existing.tokens.map((token) => {
        if (token.mint !== mint) return token;
        const current = decimalBalanceToAtomic(token.balance, token.decimals) ?? 0n;
        const next = current - delta < 0n ? 0n : current - delta;
        return { ...token, balance: formatWalletBalance(next, token.decimals) };
      });
      queryClient.setQueryData<WalletBalanceResponse>(key, {
        ...existing,
        tokens,
        fetchedAt: Date.now(),
      });
    },
    [queryClient],
  );

  /**
   * Optimistic update for withdraw / claim: credit `atomicAmount` to
   * the public token balance (or insert a new row if the user did not
   * previously hold the token).
   */
  const applyOptimisticCredit = useCallback(
    (
      params: ScheduleParams & {
        mint: string;
        atomicAmount: string;
        symbol?: string;
        name?: string;
        decimals?: number;
      },
    ) => {
      const { walletAddress, network, mint, atomicAmount } = params;
      if (walletAddress == null || network == null) return;
      const key = offpayWalletBalanceQueryKey(walletAddress, network);
      const existing = queryClient.getQueryData<WalletBalanceResponse>(key);
      if (existing == null) return;
      const delta = safeBigInt(atomicAmount);
      if (delta == null || delta <= 0n) return;

      const matchingIndex = existing.tokens.findIndex((token) => token.mint === mint);
      let tokens = existing.tokens.slice();
      if (matchingIndex >= 0) {
        const token = tokens[matchingIndex];
        const current = decimalBalanceToAtomic(token.balance, token.decimals) ?? 0n;
        tokens[matchingIndex] = {
          ...token,
          balance: formatWalletBalance(current + delta, token.decimals),
        };
      } else if (params.symbol != null && params.decimals != null) {
        tokens = [
          {
            mint,
            balance: formatWalletBalance(delta, params.decimals),
            decimals: params.decimals,
            symbol: params.symbol,
            name: params.name ?? params.symbol,
            logo: null,
            verified: false,
            spam: false,
          },
          ...tokens,
        ];
      }
      queryClient.setQueryData<WalletBalanceResponse>(key, {
        ...existing,
        tokens,
        fetchedAt: Date.now(),
      });
    },
    [queryClient],
  );

  return {
    scheduleRefresh,
    applyOptimisticShield,
    applyOptimisticCredit,
    cancel: cancelPending,
  };
}

function decimalBalanceToAtomic(value: string, decimals: number): bigint | null {
  const atomic = decimalInputToAtomicAmount(value, decimals);
  return atomic == null ? null : BigInt(atomic);
}

function formatWalletBalance(value: bigint, decimals: number): string {
  return formatAtomicAmount(value < 0n ? '0' : value.toString(), decimals, decimals);
}

function safeBigInt(value: string | number | bigint | null | undefined): bigint | null {
  if (value == null) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}
