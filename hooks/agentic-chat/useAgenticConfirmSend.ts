/**
 * Hook that turns a drafted `AgenticPrivateSendAction` (status =
 * `needs_confirmation`) into an actually-broadcast transfer. Owns:
 *
 * - Re-validating the draft against the current scope to defend against
 *   stale state.
 * - Running the route-appropriate submitter (`submitNormalTokenTransfer`
 *   for the normal route, `submitPrivatePayment` for MagicBlock).
 * - Recording a receipt, invalidating dependent queries, updating the
 *   action status, and surfacing toasts.
 *
 * Returns `confirm(action)` and `cancel(action)` callbacks for the
 * confirmation card.
 */

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAppToast } from '@/components/ui/AppToast';
import { agenticSendOutcomeSpeech } from '@/lib/agentic-payments/send-outcome-speech';
import { validateAgenticNormalSendDraft } from '@/lib/agentic-payments/normal-send';
import { validateAgenticPrivateSendDraft } from '@/lib/agentic-payments/private-send';
import {
  offpayWalletBalanceQueryKey,
  offpayWalletTransactionsBaseQueryKey,
  pendingBackupQueueStatsQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import { yieldToUi } from '@/lib/perf/ui-work-scheduler';
import {
  useAgenticChatStore,
  type AgenticChatScope,
  type AgenticPrivateSendAction,
} from '@/store/agenticChatStore';
import { usePrivatePaymentStore } from '@/store/privatePaymentStore';
import { useWalletStore } from '@/store/walletStore';
import type { CapabilitiesResponse, WalletBalanceResponse } from '@/types/offpay-api';

interface UseAgenticConfirmSendParams {
  scope: AgenticChatScope;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  balance: WalletBalanceResponse | null | undefined;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  knownWallets: ReadonlyArray<{ name: string; address: string; active: boolean }>;
  /** Optional outcome read-aloud. Receives a pre-sanitized, outcome-only phrase. */
  onSpeakOutcome?: (phrase: string) => void;
}

interface SubmitResult {
  status: 'submitted' | 'queued';
  signature: string | null;
  txId: string | null;
  initSignature: string | null;
}

export interface UseAgenticConfirmSendResult {
  confirm: (action: AgenticPrivateSendAction) => Promise<void>;
  cancel: (action: AgenticPrivateSendAction) => void;
}

export function useAgenticConfirmSend({
  scope,
  walletMode,
  canUseNetwork,
  balance,
  capabilities,
  knownWallets,
  onSpeakOutcome,
}: UseAgenticConfirmSendParams): UseAgenticConfirmSendResult {
  const queryClient = useQueryClient();
  const { showToast } = useAppToast();
  const walletId = useWalletStore((s) => s.activeWalletId);
  const updateAction = useAgenticChatStore((s) => s.updateAction);
  const addPrivateReceipt = usePrivatePaymentStore((s) => s.addReceipt);

  const cancel = useCallback(
    (action: AgenticPrivateSendAction) => {
      if (action.status !== 'needs_confirmation') return;
      updateAction(action.id, { status: 'cancelled', errorMessage: null });
    },
    [updateAction],
  );

  const confirm = useCallback(
    async (action: AgenticPrivateSendAction): Promise<void> => {
      if (action.status !== 'needs_confirmation') return;

      if (scope.walletAddress !== action.walletAddress || scope.network !== action.network) {
        const message =
          'Switch back to the wallet and network used for this draft before confirming.';
        updateAction(action.id, { status: 'failed', errorMessage: message });
        showToast({ title: 'Confirmation blocked', message, variant: 'error' });
        return;
      }

      const userText =
        action.selfRecipientRequested === true || action.recipient === action.walletAddress
          ? `${action.amount} ${action.tokenSymbol} to my own wallet on ${action.network}`
          : `${action.amount} ${action.tokenSymbol} to ${action.recipient} on ${action.network}`;
      const validationInput = {
        input: { recipient: action.recipient, amount: action.amount, token: action.tokenMint },
        userText,
        knownWallets: [...knownWallets],
        walletAddress: scope.walletAddress,
        network: scope.network,
        walletMode,
        canUseNetwork,
        balance,
        capabilities,
        allowSelfRecipient: action.selfRecipientRequested === true,
      };
      const validation =
        action.route === 'normal'
          ? validateAgenticNormalSendDraft(validationInput)
          : validateAgenticPrivateSendDraft(validationInput);
      if (!validation.ok) {
        updateAction(action.id, { status: 'failed', errorMessage: validation.message });
        showToast({ title: 'Confirmation blocked', message: validation.message, variant: 'error' });
        return;
      }

      if (action.route === 'normal' && walletId == null) {
        const message = 'Unlock wallet and try again.';
        updateAction(action.id, { status: 'failed', errorMessage: message });
        showToast({ title: 'Confirmation blocked', message, variant: 'error' });
        return;
      }

      updateAction(action.id, { status: 'submitting', errorMessage: null });
      await yieldToUi();

      try {
        const result = await runSubmitter({
          action,
          draft: validation.draft,
          walletId,
        });

        const id = result.status === 'submitted' ? result.signature : result.txId;
        const message =
          action.route === 'normal'
            ? 'Yuga normal payment submitted'
            : result.status === 'submitted'
              ? 'Yuga private payment submitted'
              : 'Yuga private payment queued';

        addPrivateReceipt({
          id: id ?? action.id,
          status: result.status,
          route: action.route,
          source: 'agentic',
          walletAddress: validation.draft.walletAddress,
          recipient: validation.draft.recipient,
          mint: validation.draft.tokenMint,
          amount: validation.draft.rawAmount,
          tokenSymbol: validation.draft.tokenSymbol,
          tokenName: validation.draft.tokenName,
          tokenLogo: validation.draft.tokenLogo,
          tokenDecimals: validation.draft.tokenDecimals,
          network: validation.draft.network,
          createdAt: Date.now(),
          signature: result.signature,
          txId: result.txId,
          initSignature: result.initSignature,
          message,
        });

        await invalidateAfterTransfer({
          queryClient,
          walletAddress: validation.draft.walletAddress,
          network: validation.draft.network,
          isNormalRoute: action.route === 'normal',
        });

        updateAction(action.id, {
          status: result.status,
          signature: result.signature,
          txId: result.txId,
          errorMessage: null,
        });
        showToast({
          title:
            result.status === 'submitted' ? 'Yuga transfer submitted' : 'Yuga transfer queued',
          message: `${validation.draft.amount} ${validation.draft.tokenSymbol}`,
          variant: 'success',
        });
        onSpeakOutcome?.(agenticSendOutcomeSpeech(result.status, action.route));
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : action.route === 'normal'
              ? 'Unable to submit normal send.'
              : 'Unable to submit private send.';
        updateAction(action.id, { status: 'failed', errorMessage: message });
        showToast({ title: 'Yuga transfer failed', message, variant: 'error' });
        onSpeakOutcome?.(agenticSendOutcomeSpeech('failed', action.route));
      }
    },
    [
      addPrivateReceipt,
      balance,
      canUseNetwork,
      capabilities,
      knownWallets,
      onSpeakOutcome,
      queryClient,
      scope.network,
      scope.walletAddress,
      showToast,
      updateAction,
      walletId,
      walletMode,
    ],
  );

  return { confirm, cancel };
}

type SubmittableDraft = Omit<
  AgenticPrivateSendAction,
  'id' | 'kind' | 'status' | 'route' | 'createdAt' | 'updatedAt'
>;

interface RunSubmitterParams {
  action: AgenticPrivateSendAction;
  draft: SubmittableDraft;
  walletId: string | null;
}

async function runSubmitter({
  action,
  draft,
  walletId,
}: RunSubmitterParams): Promise<SubmitResult> {
  if (action.route === 'normal') {
    if (walletId == null) {
      throw new Error('Unlock wallet and try again.');
    }
    const { submitNormalTokenTransfer } = await import('@/lib/payments/normal-token-transfer');
    const normalResult = await submitNormalTokenTransfer({
      walletAddress: draft.walletAddress,
      walletId,
      recipient: draft.recipient,
      mint: draft.tokenMint,
      rawAmount: draft.rawAmount,
      decimals: draft.tokenDecimals,
      network: draft.network,
    });
    return {
      status: normalResult.status,
      signature: normalResult.signature,
      txId: null,
      initSignature: null,
    };
  }

  const { submitPrivatePayment } = await import('@/lib/magicblock/private-payment');
  const privateResult = await submitPrivatePayment({
    walletAddress: draft.walletAddress,
    walletId,
    recipient: draft.recipient,
    amount: draft.rawAmount,
    mint: draft.tokenMint,
    network: draft.network,
  });
  return {
    status: privateResult.status,
    signature: privateResult.status === 'submitted' ? privateResult.signature : null,
    txId: privateResult.status === 'queued' ? privateResult.txId : null,
    initSignature: privateResult.initSignature,
  };
}

interface InvalidateAfterTransferParams {
  queryClient: ReturnType<typeof useQueryClient>;
  walletAddress: string;
  network: AgenticChatScope['network'];
  isNormalRoute: boolean;
}

function invalidateAfterTransfer({
  queryClient,
  walletAddress,
  network,
  isNormalRoute,
}: InvalidateAfterTransferParams): Promise<unknown> {
  if (network == null) return Promise.resolve();
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: offpayWalletBalanceQueryKey(walletAddress, network),
      refetchType: 'active',
    }),
    queryClient.invalidateQueries({
      queryKey: offpayWalletTransactionsBaseQueryKey(walletAddress, network),
      refetchType: 'all',
    }),
    ...(isNormalRoute
      ? []
      : [
          queryClient.invalidateQueries({
            queryKey: pendingBackupQueueStatsQueryKey(walletAddress, network),
          }),
        ]),
  ]);
}
