import { useMutation } from '@tanstack/react-query';

import { useUmbraCacheInvalidator } from '@/hooks/useUmbraCacheInvalidator';
import {
  ensureUmbraEncryptedBalanceRegistration,
  ensureUmbraMixerRegistration,
  repairUmbraVaultEncryptionKey,
  shieldTokenWithUmbra,
  withdrawTokenFromUmbra,
} from '@/lib/umbra/umbra-execution';
import { useUmbraPrivacyStore } from '@/store/umbraPrivacyStore';

import type {
  UmbraExecutionResult,
  UmbraTokenExecutionParams,
  UmbraUnshieldParams,
  UmbraVaultKeyRepairParams,
  UmbraWalletExecutionParams,
} from '@/lib/umbra/umbra-execution';

function receiptId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useUmbraExecution() {
  const addReceipt = useUmbraPrivacyStore((state) => state.addReceipt);
  const { scheduleRefresh, applyOptimisticShield, applyOptimisticCredit } =
    useUmbraCacheInvalidator();

  const onExecutionSuccess = (result: UmbraExecutionResult) => {
    if (result.action !== 'claim') {
      addReceipt({
        id: receiptId(result.action),
        action: result.action,
        title: result.title,
        subtitle: result.subtitle,
        signature: result.primarySignature ?? result.signatures[0] ?? null,
        network: result.network,
        createdAt: Date.now(),
      });
    }

    // Optimistic public-balance updates so the UI reflects the new
    // value immediately. Provider/indexer views can lag finalization,
    // so a bare invalidate-and-refetch right after success can still
    // return the previous on-chain snapshot. The retry-poll schedule
    // below overwrites this with the authoritative value once upstream
    // state catches up.
    if (result.mint != null && result.amountAtomic != null) {
      if (result.action === 'shield') {
        applyOptimisticShield({
          walletAddress: result.walletAddress,
          network: result.network,
          mint: result.mint,
          atomicAmount: result.amountAtomic,
        });
      } else if (result.action === 'unshield') {
        applyOptimisticCredit({
          walletAddress: result.walletAddress,
          network: result.network,
          mint: result.mint,
          atomicAmount: result.amountAtomic,
        });
      }
    }

    // The Arcium MPC callback typically lands a few seconds after the
    // SDK promise resolves. The invalidator runs an immediate
    // refresh, then schedules retry-polls at 5 s / 15 s / 30 s / 60 s
    // so the UI surfaces the new on-chain state once the upstream
    // cache rolls over.
    scheduleRefresh({
      walletAddress: result.walletAddress,
      network: result.network,
    });
  };

  const registerMutation = useMutation({
    mutationFn: (params: UmbraWalletExecutionParams) =>
      ensureUmbraEncryptedBalanceRegistration(params),
    retry: false,
    onSuccess: onExecutionSuccess,
  });

  const mixerRegisterMutation = useMutation({
    mutationFn: (params: UmbraWalletExecutionParams) => ensureUmbraMixerRegistration(params),
    retry: false,
    onSuccess: onExecutionSuccess,
  });

  const shieldMutation = useMutation({
    mutationFn: (params: UmbraTokenExecutionParams) => shieldTokenWithUmbra(params),
    retry: false,
    onSuccess: onExecutionSuccess,
  });

  const unshieldMutation = useMutation({
    mutationFn: (params: UmbraUnshieldParams) => withdrawTokenFromUmbra(params),
    retry: false,
    onSuccess: onExecutionSuccess,
  });

  const repairKeyMutation = useMutation({
    mutationFn: (params: UmbraVaultKeyRepairParams) => repairUmbraVaultEncryptionKey(params),
    retry: false,
    onSuccess: onExecutionSuccess,
  });

  return {
    registerMutation,
    mixerRegisterMutation,
    repairKeyMutation,
    shieldMutation,
    unshieldMutation,
  };
}
