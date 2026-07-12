/**
 * Hook that turns a drafted chat action (status =
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

import { Platform } from 'react-native';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAppToast } from '@/components/ui/AppToast';
import { useUmbraCacheInvalidator } from '@/hooks/useUmbraCacheInvalidator';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { tryAcquireAgenticActionExecution } from '@/lib/agentic-payments/action-execution-lock';
import { executeAgenticUmbraClaimAction } from '@/lib/agentic-payments/umbra-claim-action';
import { agenticSendOutcomeSpeech } from '@/lib/agentic-payments/send-outcome-speech';
import { validateAgenticNormalSendDraft } from '@/lib/agentic-payments/normal-send';
import { validateAgenticPrivateSendDraft } from '@/lib/agentic-payments/private-send';
import {
  offpayWalletDashboardBaseQueryKey,
  offpayWalletBalanceQueryKey,
  offpayWalletTokenTransactionsBaseQueryKey,
  offpayWalletTransactionsBaseQueryKey,
  pendingBackupQueueStatsQueryKey,
} from '@/lib/api/offpay-wallet-query-keys';
import {
  buildUmbraTransactionNotificationIdentifier,
  presentUmbraTransactionNotification,
  presentWalletTransactionEventNotification,
} from '@/lib/notifications/local-notifications';
import { yieldToUi } from '@/lib/perf/ui-work-scheduler';
import { formatAtomicAmount } from '@/lib/policy/token-amounts';
import { resolveSwapExecutionAmounts } from '@/lib/swap/normal-swap-execution';
import { isRnZkProverNativeModuleAvailable } from '@/lib/umbra/umbra-rn-zk-prover';
import { isUmbraNetworkSupported } from '@/lib/umbra/umbra-supported-tokens';
import { getWalletSigningBlocker } from '@/lib/wallet/wallet-capabilities';
import {
  resolveTransferTokenForRoute,
  routeKind,
  type AgenticTransferRoute,
} from '@/lib/agentic-payments/transfer-route-token';
import {
  useAgenticChatStore,
  type AgenticChatAction,
  type AgenticAdvancedSwapAction,
  type AgenticAdvancedSwapCancelAction,
  type AgenticChatScope,
  type AgenticPrivateSendAction,
  type AgenticRwaTradeAction,
  type AgenticSwapAction,
  type AgenticFlashDepositAction,
  type AgenticFlashPositionAction,
  type AgenticUmbraClaimAction,
  type AgenticUmbraVaultAction,
} from '@/store/agenticChatStore';
import { useContactsStore } from '@/store/contactsStore';
import { usePrivatePaymentStore } from '@/store/privatePaymentStore';
import { useUmbraPrivacyStore } from '@/store/umbraPrivacyStore';
import { useWalletStore } from '@/store/walletStore';
import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';
import type { CapabilitiesResponse, WalletBalanceResponse } from '@/types/offpay-api';

interface UseAgenticConfirmSendParams {
  scope: AgenticChatScope;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  balance: WalletBalanceResponse | null | undefined;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  knownWallets: ReadonlyArray<{ name: string; address: string; active: boolean }>;
  walletImportMethod: WalletImportMethod | null;
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
  confirm: (action: AgenticChatAction) => Promise<void>;
  cancel: (action: AgenticChatAction) => void;
  changeRoute: (
    action: AgenticChatAction,
    route: AgenticPrivateSendAction['route'],
  ) => Promise<void>;
}

export function useAgenticConfirmSend({
  scope,
  walletMode,
  canUseNetwork,
  balance,
  capabilities,
  knownWallets,
  walletImportMethod,
  onSpeakOutcome,
}: UseAgenticConfirmSendParams): UseAgenticConfirmSendResult {
  const queryClient = useQueryClient();
  const { showToast } = useAppToast();
  const walletId = useWalletStore((s) => s.activeWalletId);
  const updateAction = useAgenticChatStore((s) => s.updateAction);
  const addPrivateReceipt = usePrivatePaymentStore((s) => s.addReceipt);
  const markRecipientUsed = useContactsStore((s) => s.markRecipientUsed);
  const addUmbraReceipt = useUmbraPrivacyStore((s) => s.addReceipt);
  const { scheduleRefresh, applyOptimisticShield, applyOptimisticCredit } =
    useUmbraCacheInvalidator();

  const cancel = useCallback(
    (requestedAction: AgenticChatAction) => {
      const release = tryAcquireAgenticActionExecution(requestedAction.id);
      if (release == null) return;

      try {
        const action = useAgenticChatStore
          .getState()
          .actions.find((candidate) => candidate.id === requestedAction.id);
        if (action?.status !== 'needs_confirmation') return;
        updateAction(action.id, { status: 'cancelled', errorMessage: null });
      } finally {
        release();
      }
    },
    [updateAction],
  );

  const changeRoute = useCallback(
    async (
      requestedAction: AgenticChatAction,
      route: AgenticPrivateSendAction['route'],
    ): Promise<void> => {
      const release = tryAcquireAgenticActionExecution(requestedAction.id);
      if (release == null) return;

      try {
        const action = useAgenticChatStore
          .getState()
          .actions.find((candidate) => candidate.id === requestedAction.id);
        if (action == null || !isTransferAction(action) || action.status !== 'needs_confirmation') {
          return;
        }
        if (action.route === route) return;
        if (scope.walletAddress !== action.walletAddress || scope.network !== action.network) {
          const message = 'Switch back to this draft wallet/network first.';
          updateAction(action.id, { errorMessage: message });
          showToast({ title: 'Route blocked', message, variant: 'error' });
          return;
        }

        const validation = validateTransferActionForRoute({
          action,
          route,
          scope,
          walletMode,
          canUseNetwork,
          balance,
          capabilities,
          knownWallets,
          walletImportMethod,
        });

        if (!validation.ok) {
          updateAction(action.id, { errorMessage: validation.message });
          showToast({ title: 'Route unavailable', message: validation.message, variant: 'error' });
          return;
        }

        updateAction(action.id, {
          kind: routeKind(route),
          route,
          ...validation.draft,
          status: 'needs_confirmation',
          signature: null,
          txId: null,
          errorMessage: null,
        });
      } finally {
        release();
      }
    },
    [
      balance,
      canUseNetwork,
      capabilities,
      knownWallets,
      scope,
      showToast,
      updateAction,
      walletImportMethod,
      walletMode,
    ],
  );

  const confirm = useCallback(
    async (requestedAction: AgenticChatAction): Promise<void> => {
      const release = tryAcquireAgenticActionExecution(requestedAction.id);
      if (release == null) return;

      try {
        const action = useAgenticChatStore
          .getState()
          .actions.find((candidate) => candidate.id === requestedAction.id);
        if (action?.status !== 'needs_confirmation') return;
        if (action.kind === 'payroll') return;

        if (scope.walletAddress !== action.walletAddress || scope.network !== action.network) {
          const message =
            'Switch back to the wallet and network used for this draft before confirming.';
          updateAction(action.id, { status: 'failed', errorMessage: message });
          showToast({ title: 'Confirmation blocked', message, variant: 'error' });
          return;
        }

        if (action.kind === 'swap') {
          await confirmSwapAction({
            action,
            walletId,
            queryClient,
            updateAction,
            showToast,
          });
          return;
        }

        if (action.kind === 'swap_trigger' || action.kind === 'swap_recurring') {
          await confirmAdvancedSwapAction({
            action,
            walletId,
            queryClient,
            updateAction,
            showToast,
          });
          return;
        }

        if (action.kind === 'swap_trigger_cancel' || action.kind === 'swap_recurring_cancel') {
          await confirmAdvancedSwapCancellationAction({
            action,
            walletId,
            queryClient,
            updateAction,
            showToast,
          });
          return;
        }

        if (action.kind === 'rwa_trade') {
          await confirmRwaTradeAction({
            action,
            walletId,
            balance,
            queryClient,
            updateAction,
            showToast,
          });
          return;
        }

        if (action.kind === 'flash_position') {
          await confirmFlashPositionAction({
            action,
            walletId,
            queryClient,
            updateAction,
            showToast,
          });
          return;
        }

        if (action.kind === 'flash_deposit') {
          await confirmFlashDepositAction({
            action,
            walletId,
            queryClient,
            updateAction,
            showToast,
          });
          return;
        }

        if (action.kind === 'umbra_vault') {
          await confirmUmbraVaultAction({
            action,
            walletId,
            walletMode,
            canUseNetwork,
            capabilities,
            walletImportMethod,
            updateAction,
            showToast,
            addUmbraReceipt,
            scheduleRefresh,
            applyOptimisticShield,
            applyOptimisticCredit,
            onSpeakOutcome,
          });
          return;
        }

        if (action.kind === 'umbra_claim') {
          await confirmUmbraClaimAction({
            action,
            walletId,
            walletMode,
            canUseNetwork,
            capabilities,
            walletImportMethod,
            updateAction,
            showToast,
            addUmbraReceipt,
            scheduleRefresh,
            onSpeakOutcome,
          });
          return;
        }

        if (!isTransferAction(action)) return;

        const validation = validateTransferActionForRoute({
          action,
          route: action.route,
          scope,
          walletMode,
          canUseNetwork,
          balance,
          capabilities,
          knownWallets,
          walletImportMethod,
        });
        if (!validation.ok) {
          updateAction(action.id, { status: 'failed', errorMessage: validation.message });
          showToast({
            title: 'Confirmation blocked',
            message: validation.message,
            variant: 'error',
          });
          return;
        }

        if ((action.route === 'normal' || action.route === 'umbra') && walletId == null) {
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
            walletImportMethod,
          });

          const id = result.status === 'submitted' ? result.signature : result.txId;
          if (id != null) {
            void presentWalletTransactionEventNotification({
              identifier: `wallet-transaction-${validation.draft.network}-${id}`,
              type: 'send',
              amountLabel: `-${validation.draft.amount} ${validation.draft.tokenSymbol}`,
              signature: id,
            });
          }
          const message =
            action.route === 'normal'
              ? 'Yuga normal payment succeeded'
              : action.route === 'umbra'
                ? 'Yuga Umbra private payment succeeded'
                : result.status === 'submitted'
                  ? 'Yuga private payment succeeded'
                  : 'Yuga private payment queued';

          const submittedAt = Date.now();
          markRecipientUsed({
            walletAddress: validation.draft.walletAddress,
            recipientAddress: validation.draft.recipient,
            usedAt: submittedAt,
          });
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
            createdAt: submittedAt,
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
            includeUmbraInvalidation: action.route === 'umbra',
          });

          updateAction(action.id, {
            status: result.status,
            signature: result.signature,
            txId: result.txId,
            errorMessage: null,
          });
          showToast({
            title:
              result.status === 'submitted' ? 'Yuga transfer succeeded' : 'Yuga transfer queued',
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
                : action.route === 'umbra'
                  ? 'Unable to submit Umbra private send.'
                  : 'Unable to submit private send.';
          updateAction(action.id, { status: 'failed', errorMessage: message });
          showToast({ title: 'Yuga transfer failed', message, variant: 'error' });
          onSpeakOutcome?.(agenticSendOutcomeSpeech('failed', action.route));
        }
      } finally {
        release();
      }
    },
    [
      addPrivateReceipt,
      addUmbraReceipt,
      applyOptimisticCredit,
      applyOptimisticShield,
      balance,
      canUseNetwork,
      capabilities,
      knownWallets,
      markRecipientUsed,
      onSpeakOutcome,
      queryClient,
      scope.network,
      scope.walletAddress,
      scheduleRefresh,
      showToast,
      updateAction,
      walletImportMethod,
      walletId,
      walletMode,
    ],
  );

  return { confirm, cancel, changeRoute };
}

function isTransferAction(action: AgenticChatAction): action is AgenticPrivateSendAction {
  return action.kind === 'private_send' || action.kind === 'normal_send';
}

type SubmittableDraft = Omit<
  AgenticPrivateSendAction,
  'id' | 'kind' | 'status' | 'route' | 'createdAt' | 'updatedAt'
>;

type TransferRouteValidation =
  | { ok: true; draft: SubmittableDraft }
  | { ok: false; message: string };

function validateTransferActionForRoute(params: {
  action: AgenticPrivateSendAction;
  route: AgenticTransferRoute;
  scope: AgenticChatScope;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  balance: WalletBalanceResponse | null | undefined;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  knownWallets: ReadonlyArray<{ name: string; address: string; active: boolean }>;
  walletImportMethod: WalletImportMethod | null;
}): TransferRouteValidation {
  const tokenInput = resolveTokenInputForRoute(params);
  if (!tokenInput.ok) return tokenInput;

  const userText =
    params.action.selfRecipientRequested === true ||
    params.action.recipient === params.action.walletAddress
      ? `${params.action.amount} ${params.action.tokenSymbol} to my own wallet on ${params.action.network}`
      : `${params.action.amount} ${params.action.tokenSymbol} to ${params.action.recipient} on ${params.action.network}`;

  const validationInput = {
    input: {
      recipient: params.action.recipient,
      amount: params.action.amount,
      token: tokenInput.token,
    },
    userText,
    knownWallets: [...params.knownWallets],
    walletAddress: params.scope.walletAddress,
    network: params.scope.network,
    walletMode: params.walletMode,
    canUseNetwork: params.canUseNetwork,
    balance: params.balance,
    capabilities: params.capabilities,
    allowSelfRecipient: params.action.selfRecipientRequested === true,
  };

  const validation =
    params.route === 'magicblock'
      ? validateAgenticPrivateSendDraft(validationInput)
      : validateAgenticNormalSendDraft(validationInput);

  return validation.ok ? { ok: true, draft: validation.draft } : validation;
}

function resolveTokenInputForRoute(params: {
  action: AgenticPrivateSendAction;
  route: AgenticTransferRoute;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  balance: WalletBalanceResponse | null | undefined;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  walletImportMethod: WalletImportMethod | null;
}): { ok: true; token: string } | { ok: false; message: string } {
  if (params.route === 'umbra') {
    const blocker = getUmbraRouteBlocker(params);
    if (blocker != null) return { ok: false, message: blocker };
  }

  return resolveTransferTokenForRoute(params);
}

function getUmbraRouteBlocker(params: {
  action: AgenticPrivateSendAction;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  walletImportMethod: WalletImportMethod | null;
}): string | null {
  if (!isUmbraNetworkSupported(params.action.network)) {
    return 'Umbra is not available on this network.';
  }
  const signingBlocker = getWalletSigningBlocker(
    params.walletImportMethod,
    'Umbra',
    params.action.walletAddress,
  );
  if (signingBlocker != null) return signingBlocker;
  if (params.walletMode !== 'online' || !params.canUseNetwork) {
    return 'Umbra route needs online mode.';
  }
  if (Platform.OS === 'web' || !isRnZkProverNativeModuleAvailable()) {
    return 'Umbra route needs the native app.';
  }
  if (
    !isOffpayFeatureAvailable(params.capabilities ?? null, 'umbra.execution') ||
    !isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.umbraPrivateP2p') ||
    !isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.rpcBroadcast')
  ) {
    return 'Umbra route is unavailable right now.';
  }
  return null;
}

function getUmbraVaultBlocker(params: {
  action: AgenticUmbraVaultAction;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  walletImportMethod: WalletImportMethod | null;
}): string | null {
  if (!isUmbraNetworkSupported(params.action.network)) {
    return 'Umbra vault is not available on this network.';
  }
  const signingBlocker = getWalletSigningBlocker(
    params.walletImportMethod,
    'Umbra vault',
    params.action.walletAddress,
  );
  if (signingBlocker != null) return signingBlocker;
  if (params.walletMode !== 'online' || !params.canUseNetwork) {
    return 'Umbra vault needs online mode.';
  }
  if (Platform.OS === 'web' || !isRnZkProverNativeModuleAvailable()) {
    return 'Umbra vault needs the native app.';
  }
  if (!isOffpayFeatureAvailable(params.capabilities ?? null, 'umbra.execution')) {
    return 'Umbra vault is unavailable right now.';
  }
  return null;
}

function getUmbraClaimBlocker(params: {
  action: AgenticUmbraClaimAction;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  walletImportMethod: WalletImportMethod | null;
}): string | null {
  if (!isUmbraNetworkSupported(params.action.network)) {
    return 'Umbra claims are not available on this network.';
  }
  const signingBlocker = getWalletSigningBlocker(
    params.walletImportMethod,
    'Umbra claim',
    params.action.walletAddress,
  );
  if (signingBlocker != null) return signingBlocker;
  if (params.walletMode !== 'online' || !params.canUseNetwork) {
    return 'Umbra claims need online mode.';
  }
  if (Platform.OS === 'web' || !isRnZkProverNativeModuleAvailable()) {
    return 'Umbra claims need the native app.';
  }
  if (
    !isOffpayFeatureAvailable(params.capabilities ?? null, 'umbra.execution') ||
    !isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.umbraPrivateP2p') ||
    !isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.rpcBroadcast')
  ) {
    return 'Umbra claims are unavailable right now.';
  }
  return null;
}

function createAgenticUmbraReceiptId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function confirmUmbraVaultAction(params: {
  action: AgenticUmbraVaultAction;
  walletId: string | null;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  walletImportMethod: WalletImportMethod | null;
  updateAction: ReturnType<typeof useAgenticChatStore.getState>['updateAction'];
  showToast: ReturnType<typeof useAppToast>['showToast'];
  addUmbraReceipt: ReturnType<typeof useUmbraPrivacyStore.getState>['addReceipt'];
  scheduleRefresh: ReturnType<typeof useUmbraCacheInvalidator>['scheduleRefresh'];
  applyOptimisticShield: ReturnType<typeof useUmbraCacheInvalidator>['applyOptimisticShield'];
  applyOptimisticCredit: ReturnType<typeof useUmbraCacheInvalidator>['applyOptimisticCredit'];
  onSpeakOutcome?: (phrase: string) => void;
}): Promise<void> {
  const {
    action,
    walletId,
    walletMode,
    canUseNetwork,
    capabilities,
    walletImportMethod,
    updateAction,
    showToast,
    addUmbraReceipt,
    scheduleRefresh,
    applyOptimisticShield,
    applyOptimisticCredit,
    onSpeakOutcome,
  } = params;

  if (walletId == null) {
    const message = 'Unlock wallet and try again.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Confirmation blocked', message, variant: 'error' });
    return;
  }

  const blocker = getUmbraVaultBlocker({
    action,
    walletMode,
    canUseNetwork,
    capabilities,
    walletImportMethod,
  });
  if (blocker != null) {
    updateAction(action.id, { status: 'failed', errorMessage: blocker });
    showToast({ title: 'Confirmation blocked', message: blocker, variant: 'error' });
    return;
  }

  updateAction(action.id, { status: 'submitting', errorMessage: null });
  await yieldToUi();

  try {
    const { shieldTokenWithUmbra, withdrawTokenFromUmbra } =
      await import('@/lib/umbra/umbra-execution');
    const result =
      action.operation === 'shield'
        ? await shieldTokenWithUmbra({
            walletAddress: action.walletAddress,
            walletId,
            network: action.network,
            token: action.tokenMint,
            tokenMint: action.tokenMint,
            amount: action.amount,
          })
        : await withdrawTokenFromUmbra({
            walletAddress: action.walletAddress,
            walletId,
            network: action.network,
            token: action.tokenMint,
            tokenMint: action.tokenMint,
            amount: action.amount,
            recipient: action.walletAddress,
          });
    const signature = result.primarySignature ?? result.signatures[0] ?? null;
    const notificationAction = action.operation === 'shield' ? 'shield' : 'withdraw';
    const amountLabel = `${result.amountDisplay ?? action.amount} ${
      result.tokenSymbol ?? action.tokenSymbol
    }`;

    addUmbraReceipt({
      id: createAgenticUmbraReceiptId(`agentic-${action.operation}`),
      action: result.action,
      title: result.title,
      subtitle: result.subtitle,
      signature,
      network: result.network,
      createdAt: Date.now(),
    });

    void presentUmbraTransactionNotification({
      identifier: buildUmbraTransactionNotificationIdentifier({
        network: result.network,
        action: notificationAction,
        signature,
        fallbackId: `${action.walletAddress}-${action.tokenMint}-${action.rawAmount}`,
      }),
      action: notificationAction,
      amountLabel,
      signature,
    });

    const atomicAmount = result.amountAtomic ?? action.rawAmount;
    const mint = result.mint ?? action.tokenMint;
    if (action.operation === 'shield') {
      applyOptimisticShield({
        walletAddress: action.walletAddress,
        network: action.network,
        mint,
        atomicAmount,
      });
    } else {
      applyOptimisticCredit({
        walletAddress: action.walletAddress,
        network: action.network,
        mint,
        atomicAmount,
        symbol: action.tokenSymbol,
        name: action.tokenName,
        decimals: action.tokenDecimals,
      });
    }

    scheduleRefresh({
      walletAddress: action.walletAddress,
      network: action.network,
    });

    updateAction(action.id, {
      status: 'submitted',
      signature,
      errorMessage: null,
    });
    showToast({
      title: action.operation === 'shield' ? 'Umbra shield succeeded' : 'Umbra withdraw succeeded',
      message: amountLabel,
      variant: 'success',
    });
    onSpeakOutcome?.(
      action.operation === 'shield' ? 'Umbra shield succeeded.' : 'Umbra withdraw succeeded.',
    );
  } catch (error) {
    const fallback =
      action.operation === 'shield'
        ? 'Unable to shield funds into Umbra vault.'
        : 'Unable to withdraw funds from Umbra vault.';
    const message = error instanceof Error ? error.message : fallback;
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({
      title: action.operation === 'shield' ? 'Umbra shield failed' : 'Umbra withdraw failed',
      message,
      variant: 'error',
    });
    onSpeakOutcome?.(
      action.operation === 'shield' ? 'Umbra shield failed.' : 'Umbra withdraw failed.',
    );
  }
}

async function confirmUmbraClaimAction(params: {
  action: AgenticUmbraClaimAction;
  walletId: string | null;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  walletImportMethod: WalletImportMethod | null;
  updateAction: ReturnType<typeof useAgenticChatStore.getState>['updateAction'];
  showToast: ReturnType<typeof useAppToast>['showToast'];
  addUmbraReceipt: ReturnType<typeof useUmbraPrivacyStore.getState>['addReceipt'];
  scheduleRefresh: ReturnType<typeof useUmbraCacheInvalidator>['scheduleRefresh'];
  onSpeakOutcome?: (phrase: string) => void;
}): Promise<void> {
  const {
    action,
    walletId,
    walletMode,
    canUseNetwork,
    capabilities,
    walletImportMethod,
    updateAction,
    showToast,
    addUmbraReceipt,
    scheduleRefresh,
    onSpeakOutcome,
  } = params;

  if (walletId == null) {
    const message = 'Unlock wallet and try again.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Confirmation blocked', message, variant: 'error' });
    return;
  }

  const blocker = getUmbraClaimBlocker({
    action,
    walletMode,
    canUseNetwork,
    capabilities,
    walletImportMethod,
  });
  if (blocker != null) {
    updateAction(action.id, { status: 'failed', errorMessage: blocker });
    showToast({ title: 'Confirmation blocked', message: blocker, variant: 'error' });
    return;
  }

  updateAction(action.id, { status: 'submitting', errorMessage: null });
  await yieldToUi();

  try {
    const api = await import('@/lib/umbra/umbra-execution');
    const outcome = await executeAgenticUmbraClaimAction({
      action,
      walletId,
      api,
      onInsertionIndicesSettled: (insertionIndices) => {
        useUmbraPrivacyStore.getState().markUtxosClaimed({
          network: action.network,
          walletAddress: action.walletAddress,
          insertionIndices,
        });
      },
    });

    scheduleRefresh({ walletAddress: action.walletAddress, network: action.network });

    if (outcome.status === 'already_settled') {
      updateAction(action.id, {
        status: 'submitted',
        settledClaimCount: action.claimCount,
        remainingClaimCount: 0,
        signature: null,
        errorMessage: null,
      });
      showToast({
        title: 'Umbra claims already settled',
        message: 'Encrypted balance is up to date.',
        variant: 'info',
      });
      onSpeakOutcome?.('Umbra claims were already settled.');
      return;
    }

    if (outcome.status === 'stale') {
      const message =
        outcome.currentPendingCount === 0
          ? 'These claims were already settled. Ask Yuga to scan again.'
          : 'The pending Umbra claim set changed. Ask Yuga to prepare a fresh claim.';
      updateAction(action.id, { status: 'failed', errorMessage: message });
      showToast({ title: 'Fresh confirmation required', message, variant: 'warning' });
      onSpeakOutcome?.('Umbra claims changed. A fresh confirmation is required.');
      return;
    }

    const { result, settledInsertionIndices, remainingInsertionIndices } = outcome;
    const submittedCount = result.claimedUtxoCount ?? 0;
    const signature = result.primarySignature ?? result.signatures[0] ?? null;

    if (submittedCount > 0) {
      addUmbraReceipt({
        id: createAgenticUmbraReceiptId('agentic-claim'),
        action: 'claim',
        title: result.title,
        subtitle: result.subtitle,
        signature,
        network: result.network,
        createdAt: Date.now(),
      });
      void presentUmbraTransactionNotification({
        identifier: buildUmbraTransactionNotificationIdentifier({
          network: result.network,
          action: 'claim',
          signature,
          fallbackId: action.id,
        }),
        action: 'claim',
        claimedCount: submittedCount,
        signature,
      });
    }

    const partial = remainingInsertionIndices.length > 0;
    const message = partial
      ? `${settledInsertionIndices.length} settled; ${remainingInsertionIndices.length} still pending. Ask Yuga to scan again.`
      : submittedCount > 0
        ? result.subtitle
        : 'Encrypted balance is already up to date.';
    updateAction(action.id, {
      status: partial ? 'failed' : 'submitted',
      settledClaimCount: settledInsertionIndices.length,
      remainingClaimCount: remainingInsertionIndices.length,
      signature,
      errorMessage: partial ? message : null,
    });
    showToast({
      title: partial
        ? 'Umbra claim partly succeeded'
        : submittedCount > 0
          ? 'Umbra claim succeeded'
          : 'Umbra claims already settled',
      message,
      variant: partial ? 'warning' : 'success',
    });
    onSpeakOutcome?.(partial ? 'Umbra claim partly succeeded.' : 'Umbra claim succeeded.');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to claim Umbra private payments.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Umbra claim failed', message, variant: 'error' });
    onSpeakOutcome?.('Umbra claim failed.');
  }
}

interface RunSubmitterParams {
  action: AgenticPrivateSendAction;
  draft: SubmittableDraft;
  walletId: string | null;
  walletImportMethod: WalletImportMethod | null;
}

async function runSubmitter({
  action,
  draft,
  walletId,
  walletImportMethod,
}: RunSubmitterParams): Promise<SubmitResult> {
  if (action.route === 'normal') {
    if (walletId == null) {
      throw new Error('Unlock wallet and try again.');
    }
    const signingBlocker = getWalletSigningBlocker(
      walletImportMethod,
      'Normal send',
      draft.walletAddress,
    );
    if (signingBlocker != null) {
      throw new Error(signingBlocker);
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

  if (action.route === 'umbra') {
    if (walletId == null) {
      throw new Error('Unlock wallet and try again.');
    }
    const signingBlocker = getWalletSigningBlocker(
      walletImportMethod,
      'Umbra',
      draft.walletAddress,
    );
    if (signingBlocker != null) {
      throw new Error(signingBlocker);
    }
    const { sendUmbraPrivateP2PFromPublicBalance } = await import('@/lib/umbra/umbra-execution');
    const umbraResult = await sendUmbraPrivateP2PFromPublicBalance({
      walletAddress: draft.walletAddress,
      walletId,
      recipient: draft.recipient,
      token: draft.tokenMint,
      amount: draft.amount,
      network: draft.network,
      autoSetupSender: true,
    });
    return {
      status: 'submitted',
      signature: umbraResult.primarySignature ?? umbraResult.signatures[0] ?? null,
      txId: null,
      initSignature: null,
    };
  }

  const { submitPrivatePayment } = await import('@/lib/magicblock/private-payment');
  const signingBlocker = getWalletSigningBlocker(
    walletImportMethod,
    'MagicBlock',
    draft.walletAddress,
  );
  if (signingBlocker != null) {
    throw new Error(signingBlocker);
  }
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
  includeUmbraInvalidation?: boolean;
}

function invalidateAfterTransfer({
  queryClient,
  walletAddress,
  network,
  isNormalRoute,
  includeUmbraInvalidation = false,
}: InvalidateAfterTransferParams): Promise<unknown> {
  if (network == null) return Promise.resolve();
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: offpayWalletDashboardBaseQueryKey(walletAddress, network),
      refetchType: 'active',
    }),
    queryClient.invalidateQueries({
      queryKey: offpayWalletBalanceQueryKey(walletAddress, network),
      refetchType: 'active',
    }),
    queryClient.invalidateQueries({
      queryKey: offpayWalletTransactionsBaseQueryKey(walletAddress, network),
      refetchType: 'all',
    }),
    queryClient.invalidateQueries({
      queryKey: offpayWalletTokenTransactionsBaseQueryKey(walletAddress, network),
      refetchType: 'all',
    }),
    ...(isNormalRoute
      ? []
      : [
          queryClient.invalidateQueries({
            queryKey: pendingBackupQueueStatsQueryKey(walletAddress, network),
          }),
        ]),
    ...(includeUmbraInvalidation
      ? [
          queryClient.invalidateQueries({
            queryKey: ['offpay', 'umbraEncryptedBalances', network, walletAddress],
          }),
        ]
      : []),
  ]);
}

async function confirmAdvancedSwapAction(params: {
  action: AgenticAdvancedSwapAction;
  walletId: string | null;
  queryClient: ReturnType<typeof useQueryClient>;
  updateAction: ReturnType<typeof useAgenticChatStore.getState>['updateAction'];
  showToast: ReturnType<typeof useAppToast>['showToast'];
}): Promise<void> {
  const { action, walletId, queryClient, updateAction, showToast } = params;
  if (walletId == null) {
    const message = 'Unlock wallet and try again.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Confirmation blocked', message, variant: 'error' });
    return;
  }

  updateAction(action.id, { status: 'submitting', errorMessage: null });
  await yieldToUi();

  try {
    const [{ revalidateAdvancedSwapAction }, advancedSwap, advancedSwapStore] = await Promise.all([
      import('@/lib/agentic-payments/tools/advanced-swaps'),
      import('@/lib/swap/advanced-swap'),
      import('@/store/advancedSwapStore'),
    ]);
    await revalidateAdvancedSwapAction(action);

    const recurringIdentity =
      action.kind === 'swap_recurring'
        ? advancedSwapStore.getOrCreatePersistedRecurringOperationIdentity({
            fingerprint: advancedSwap.buildRecurringOperationFingerprint({
              walletAddress: action.walletAddress,
              network: action.network,
              inputMint: action.inputMint,
              outputMint: action.outputMint,
              amount: action.inputRawAmount,
              frequency: action.frequency,
            }),
            createKey: () => action.id,
          })
        : null;

    const execution =
      action.kind === 'swap_trigger'
        ? await advancedSwap
            .createTriggerOrder({
              walletAddress: action.walletAddress,
              walletId,
              inputMint: action.inputMint,
              outputMint: action.outputMint,
              amount: action.inputRawAmount,
              orderType: 'single',
              triggerMint: action.triggerMint,
              triggerCondition: action.triggerCondition,
              triggerPriceUsd: action.triggerPriceUsd,
              slippageBps: action.slippageBps,
              expiresAt: action.expiresAt,
              network: action.network,
            })
            .then((result) => ({
              signature: result.depositSignature,
              providerOrderId: result.triggerId,
            }))
        : await advancedSwap
            .createAndExecuteRecurringSwap({
              walletAddress: action.walletAddress,
              walletId,
              inputMint: action.inputMint,
              outputMint: action.outputMint,
              amount: action.inputRawAmount,
              frequency: action.frequency,
              idempotencyKey: recurringIdentity?.idempotencyKey ?? action.id,
              network: action.network,
            })
            .then((result) => {
              if (result.orderId == null) {
                throw new Error('Jupiter did not return the recurring order account.');
              }
              return {
                signature: result.signature,
                providerOrderId: result.orderId,
              };
            });
    const { signature, providerOrderId } = execution;

    advancedSwapStore.useAdvancedSwapStore.getState().addReceipt({
      id: providerOrderId,
      mode: action.kind === 'swap_trigger' ? 'trigger' : 'recurring',
      title: action.kind === 'swap_trigger' ? 'Trigger order open' : 'Recurring swap submitted',
      subtitle: `Jupiter order ${providerOrderId}`,
      signature,
      network: action.network,
      walletAddress: action.walletAddress,
      createdAt: Date.now(),
      input: {
        mint: action.inputMint,
        symbol: action.inputSymbol,
        name: action.inputName,
        decimals: action.inputDecimals,
        rawAmount: action.inputRawAmount,
        amountLabel: `-${action.inputAmount} ${action.inputSymbol}`,
      },
      output: {
        mint: action.outputMint,
        symbol: action.outputSymbol,
        name: action.outputName,
        decimals: action.outputDecimals,
      },
    });
    void presentWalletTransactionEventNotification({
      identifier: `wallet-transaction-${action.network}-${signature}`,
      type: 'send',
      amountLabel: `-${action.inputAmount} ${action.inputSymbol}`,
      signature,
    });
    await invalidateAfterTransfer({
      queryClient,
      walletAddress: action.walletAddress,
      network: action.network,
      isNormalRoute: true,
    });
    updateAction(action.id, {
      status: 'submitted',
      signature,
      providerOrderId,
      errorMessage: null,
    });
    showToast({
      title: action.kind === 'swap_trigger' ? 'Trigger order created' : 'Recurring order created',
      message: `${action.inputAmount} ${action.inputSymbol} deposited through Jupiter.`,
      variant: 'success',
    });
    if (recurringIdentity != null) {
      advancedSwapStore.clearPersistedRecurringOperationIdentity({
        idempotencyKey: recurringIdentity.idempotencyKey,
      });
    }
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : 'Unable to create advanced swap.';
    const message = `${baseMessage} Check Jupiter before retrying if a wallet approval completed.`;
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Advanced swap failed', message, variant: 'error' });
  }
}

async function confirmAdvancedSwapCancellationAction(params: {
  action: AgenticAdvancedSwapCancelAction;
  walletId: string | null;
  queryClient: ReturnType<typeof useQueryClient>;
  updateAction: ReturnType<typeof useAgenticChatStore.getState>['updateAction'];
  showToast: ReturnType<typeof useAppToast>['showToast'];
}): Promise<void> {
  const { action, walletId, queryClient, updateAction, showToast } = params;
  if (walletId == null) {
    const message = 'Unlock wallet and try again.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Confirmation blocked', message, variant: 'error' });
    return;
  }

  updateAction(action.id, { status: 'submitting', errorMessage: null });
  await yieldToUi();

  try {
    const [advancedSwap, { useAdvancedSwapStore }] = await Promise.all([
      import('@/lib/swap/advanced-swap'),
      import('@/store/advancedSwapStore'),
    ]);
    const result =
      action.kind === 'swap_trigger_cancel'
        ? await advancedSwap.cancelTriggerOrder({
            walletAddress: action.walletAddress,
            walletId,
            orderId: action.orderId,
            network: action.network,
          })
        : await advancedSwap.cancelRecurringOrder({
            walletAddress: action.walletAddress,
            walletId,
            orderId: action.orderId,
            inputMint: action.inputMint,
            outputMint: action.outputMint,
            network: action.network,
          });

    useAdvancedSwapStore.getState().addReceipt({
      id: `${action.kind}-${action.orderId}`,
      mode: action.kind === 'swap_trigger_cancel' ? 'trigger' : 'recurring',
      title:
        action.kind === 'swap_trigger_cancel'
          ? 'Trigger funds recovered'
          : 'Recurring order closed',
      subtitle: `Jupiter order ${action.orderId}`,
      signature: result.signature,
      network: action.network,
      walletAddress: action.walletAddress,
      createdAt: Date.now(),
      input: { mint: action.inputMint, symbol: action.inputSymbol },
      output: { mint: action.outputMint, symbol: action.outputSymbol },
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['advanced-swap-orders'] }),
      invalidateAfterTransfer({
        queryClient,
        walletAddress: action.walletAddress,
        network: action.network,
        isNormalRoute: true,
      }),
    ]);
    updateAction(action.id, {
      status: 'submitted',
      signature: result.signature,
      errorMessage: null,
    });
    showToast({
      title:
        action.kind === 'swap_trigger_cancel'
          ? 'Trigger order cancelled'
          : 'Recurring order cancelled',
      message: 'Recoverable funds were returned through Jupiter.',
      variant: 'success',
    });
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : 'Unable to cancel advanced order.';
    const message = `${baseMessage} Check Jupiter before retrying if a wallet approval completed.`;
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Cancellation failed', message, variant: 'error' });
  }
}

const SWAP_QUOTE_REFRESH_BUFFER_MS = 15_000;

async function confirmSwapAction(params: {
  action: AgenticSwapAction;
  walletId: string | null;
  queryClient: ReturnType<typeof useQueryClient>;
  updateAction: ReturnType<typeof useAgenticChatStore.getState>['updateAction'];
  showToast: ReturnType<typeof useAppToast>['showToast'];
}): Promise<void> {
  const { action, walletId, queryClient, updateAction, showToast } = params;
  if (walletId == null) {
    const message = 'Unlock wallet and try again.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Confirmation blocked', message, variant: 'error' });
    return;
  }

  updateAction(action.id, { status: 'submitting', errorMessage: null });
  await yieldToUi();

  try {
    const { createSwapQuote, executeSwapQuote } = await import('@/lib/api/offpay-api-client');
    if (action.expiresAt - Date.now() <= SWAP_QUOTE_REFRESH_BUFFER_MS) {
      const freshQuote = await createSwapQuote({
        inputMint: action.inputMint,
        outputMint: action.outputMint,
        amount: action.inputRawAmount,
        network: action.network,
        ...(action.slippageBps == null
          ? {}
          : {
              slippageBps: action.slippageBps,
              useManualSlippage: action.slippageMode === 'manual',
            }),
      });
      if (freshQuote.unsignedTransaction.trim().length === 0) {
        throw new Error('Jupiter returned an invalid refreshed swap quote.');
      }
      const refreshedOutputAmount = formatAtomicAmount(freshQuote.outAmount, action.outputDecimals);
      updateAction(action.id, {
        status: 'needs_confirmation',
        quoteId: freshQuote.quoteId,
        unsignedTransaction: freshQuote.unsignedTransaction,
        outputRawAmount: freshQuote.outAmount,
        outputAmount: refreshedOutputAmount,
        minimumOutputAmount: freshQuote.minimumOutputAmount,
        expiresAt: freshQuote.expiresAt,
        priceImpactPct: freshQuote.priceImpactPct,
        fee: freshQuote.fee,
        routeSummary: freshQuote.routeSummary,
        slippageBps: freshQuote.slippageBps ?? null,
        slippageMode: freshQuote.slippageMode ?? null,
        errorMessage: null,
      });
      showToast({
        title: 'Swap quote refreshed',
        message: 'Review the refreshed output and minimum receive before confirming again.',
        variant: 'info',
      });
      return;
    }

    const quote = {
      quoteId: action.quoteId,
      inputMint: action.inputMint,
      outputMint: action.outputMint,
      inAmount: action.inputRawAmount,
      outAmount: action.outputRawAmount,
      minimumOutputAmount: action.minimumOutputAmount,
      slippageBps: action.slippageBps,
      slippageMode: action.slippageMode ?? undefined,
      priceImpactPct: action.priceImpactPct,
      fee: action.fee,
      routeSummary: action.routeSummary,
      expiresAt: action.expiresAt,
      unsignedTransaction: action.unsignedTransaction,
    };
    if (quote.unsignedTransaction.trim().length === 0) {
      throw new Error('Swap quote expired. Ask Yuga to prepare a fresh quote.');
    }

    const { signSerializedTransactionForWallet } =
      await import('@/lib/crypto/solana-transaction-signing');
    const signedTransaction = await signSerializedTransactionForWallet({
      unsignedTransaction: quote.unsignedTransaction,
      walletAddress: action.walletAddress,
      walletId,
    });
    const result = await executeSwapQuote({
      quoteId: quote.quoteId,
      signedTransaction,
      network: action.network,
    });
    const { inputRawAmount: executedInputRawAmount, outputRawAmount: executedOutputRawAmount } =
      resolveSwapExecutionAmounts({ execution: result, quote });
    const inputAmount = formatAtomicAmount(executedInputRawAmount, action.inputDecimals);
    const outputAmount = formatAtomicAmount(executedOutputRawAmount, action.outputDecimals);

    void presentWalletTransactionEventNotification({
      identifier: `wallet-transaction-${action.network}-${result.signature}`,
      type: 'swap',
      amountLabel: `+${outputAmount} ${action.outputSymbol}`,
      secondaryAmountLabel: `-${inputAmount} ${action.inputSymbol}`,
      signature: result.signature,
    });

    await invalidateAfterTransfer({
      queryClient,
      walletAddress: action.walletAddress,
      network: action.network,
      isNormalRoute: true,
    });

    updateAction(action.id, {
      status: 'submitted',
      signature: result.signature,
      errorMessage: null,
      quoteId: quote.quoteId,
      unsignedTransaction: quote.unsignedTransaction,
      inputRawAmount: executedInputRawAmount,
      inputAmount,
      outputRawAmount: executedOutputRawAmount,
      outputAmount,
      minimumOutputAmount: quote.minimumOutputAmount,
      expiresAt: quote.expiresAt,
      priceImpactPct: quote.priceImpactPct,
      fee: quote.fee,
      routeSummary: quote.routeSummary,
      slippageBps: quote.slippageBps ?? null,
      slippageMode: quote.slippageMode ?? null,
    });
    showToast({
      title: 'Yuga swap succeeded',
      message: `${inputAmount} ${action.inputSymbol} → ${outputAmount} ${action.outputSymbol}`,
      variant: 'success',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to submit swap.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Yuga swap failed', message, variant: 'error' });
  }
}

const RWA_QUOTE_REFRESH_BUFFER_MS = 15_000;

async function confirmRwaTradeAction(params: {
  action: AgenticRwaTradeAction;
  walletId: string | null;
  balance: WalletBalanceResponse | null | undefined;
  queryClient: ReturnType<typeof useQueryClient>;
  updateAction: ReturnType<typeof useAgenticChatStore.getState>['updateAction'];
  showToast: ReturnType<typeof useAppToast>['showToast'];
}): Promise<void> {
  const { action, walletId, balance, queryClient, updateAction, showToast } = params;
  if (walletId == null) {
    const message = 'Unlock wallet and try again.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Confirmation blocked', message, variant: 'error' });
    return;
  }

  updateAction(action.id, { status: 'submitting', errorMessage: null });
  await yieldToUi();

  try {
    const { createRwaQuote, getWalletBalance } = await import('@/lib/api/offpay-api-client');
    const { executeRwaTradeReview } = await import('@/lib/rwa/rwa-trade-execution');
    const quote =
      action.expiresAt != null && action.expiresAt - Date.now() <= RWA_QUOTE_REFRESH_BUFFER_MS
        ? await createRwaQuote({
            assetMint: action.asset.mint,
            cashAmount: action.side === 'buy' ? action.inputAmount : undefined,
            quantity: action.side === 'sell' ? action.inputAmount : undefined,
            side: action.side,
            network: action.network,
          })
        : {
            quoteId: action.quoteId,
            assetMint: action.asset.mint,
            assetSymbol: action.asset.symbol,
            settlementMint: action.asset.settlementMint,
            settlementSymbol: 'USDC' as const,
            side: action.side,
            priceUsd: action.priceUsd,
            quantity: action.quantity,
            cashAmount: action.cashAmount,
            priceImpactPct: action.priceImpactPct,
            routeSummary: action.routeSummary,
            fee: action.fee,
            slippageBps: action.slippageBps,
            expiresAt: action.expiresAt,
            provider: action.provider,
            providerEnvironment: action.providerEnvironment,
            unsignedTransaction: action.unsignedTransaction,
            transactionFormat: 'solana_legacy_transaction_base64' as const,
            unsignedTransactions: action.unsignedTransactions,
          };
    const hasUnsignedSequence =
      quote.unsignedTransactions != null && quote.unsignedTransactions.length > 0;
    if (quote.unsignedTransaction.trim().length === 0 && !hasUnsignedSequence) {
      throw new Error('RWA quote expired. Ask Yuga to prepare a fresh quote.');
    }

    const execution = await executeRwaTradeReview({
      review: {
        asset: action.asset,
        side: action.side,
        inputAmount: action.inputAmount,
        quote,
        network: action.network,
        walletAddress: action.walletAddress,
        walletId,
      },
      walletBalance: balance,
      refreshWalletBalance: () =>
        getWalletBalance(action.walletAddress, action.network, {
          requestOwner: 'agent.rwa.confirm.balance',
        }),
    });
    const payAmount =
      action.side === 'buy'
        ? (quote.cashAmount ?? action.inputAmount)
        : (quote.quantity ?? action.inputAmount);
    const receiveAmount =
      action.side === 'buy'
        ? (quote.quantity ?? action.receiveAmount)
        : (quote.cashAmount ?? action.receiveAmount);

    void presentWalletTransactionEventNotification({
      identifier: `wallet-transaction-${action.network}-${execution.execution.signature}`,
      type: 'swap',
      amountLabel: `+${receiveAmount} ${action.receiveSymbol}`,
      secondaryAmountLabel: `-${payAmount} ${action.paySymbol}`,
      signature: execution.execution.signature,
    });

    await invalidateAfterTransfer({
      queryClient,
      walletAddress: action.walletAddress,
      network: action.network,
      isNormalRoute: true,
    });

    updateAction(action.id, {
      status: 'submitted',
      signature: execution.execution.signature,
      signatures: execution.execution.signatures ?? null,
      errorMessage: null,
      quoteId: quote.quoteId,
      unsignedTransaction: quote.unsignedTransaction,
      unsignedTransactions: quote.unsignedTransactions,
      cashAmount: quote.cashAmount,
      quantity: quote.quantity,
      payAmount,
      receiveAmount,
      priceUsd: quote.priceUsd,
      priceImpactPct: quote.priceImpactPct,
      fee: quote.fee,
      routeSummary: quote.routeSummary,
      slippageBps: quote.slippageBps,
      expiresAt: quote.expiresAt,
      provider: quote.provider,
      providerEnvironment: quote.providerEnvironment,
    });
    showToast({
      title: 'RWA trade succeeded',
      message: `${action.side === 'buy' ? 'Buy' : 'Sell'} ${action.asset.symbol}`,
      variant: 'success',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to submit RWA trade.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({
      title: 'RWA trade failed',
      message,
      variant: 'error',
      notificationId: `rwa-trade-failed-${action.network}-${action.walletAddress}`,
    });
  }
}

function formatFlashNotificationAmount(action: AgenticFlashPositionAction): string {
  if (action.amountUsd != null) {
    return `${action.actionLabel} $${action.amountUsd.toFixed(2)}`;
  }
  return `${action.actionLabel} $${action.sizeUsd.toFixed(2)}`;
}

async function confirmFlashDepositAction(params: {
  action: AgenticFlashDepositAction;
  walletId: string | null;
  queryClient: ReturnType<typeof useQueryClient>;
  updateAction: ReturnType<typeof useAgenticChatStore.getState>['updateAction'];
  showToast: ReturnType<typeof useAppToast>['showToast'];
}): Promise<void> {
  const { action, updateAction, showToast } = params;
  const message =
    'Flash deposits are disabled while OffPay withdrawal is unavailable. No transaction was signed or submitted.';
  updateAction(action.id, { status: 'failed', errorMessage: message });
  showToast({ title: 'Flash funding blocked', message, variant: 'error' });
}

async function confirmFlashPositionAction(params: {
  action: AgenticFlashPositionAction;
  walletId: string | null;
  queryClient: ReturnType<typeof useQueryClient>;
  updateAction: ReturnType<typeof useAgenticChatStore.getState>['updateAction'];
  showToast: ReturnType<typeof useAppToast>['showToast'];
}): Promise<void> {
  const { action, walletId, queryClient, updateAction, showToast } = params;

  if (walletId == null) {
    const message = 'Unlock wallet and try again.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Confirmation blocked', message, variant: 'error' });
    return;
  }

  if (action.expiresAt != null && action.expiresAt - Date.now() <= 0) {
    const message = 'Quote expired. Ask Yuga to prepare a fresh transaction.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Quote expired', message, variant: 'error' });
    return;
  }
  if (action.economicIntent == null) {
    const message =
      'This legacy Flash draft lacks exact economic-intent binding. Prepare a fresh action.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Confirmation blocked', message, variant: 'error' });
    return;
  }

  updateAction(action.id, { status: 'submitting', errorMessage: null });
  await yieldToUi();

  try {
    const { signSerializedTransactionForWallet } =
      await import('@/lib/crypto/solana-transaction-signing');
    const {
      sendAndConfirmFlashTradeTransaction,
      verifyFlashTradeTransaction,
      verifySignedFlashTradeTransaction,
    } = await import('@/lib/flash-trade/execution');

    const intent = {
      walletAddress: action.walletAddress,
      economicIntent: action.economicIntent,
    } as const;

    await verifyFlashTradeTransaction({
      transactionBase64: action.transactionBase64,
      intent,
    });

    const signedTransaction = await signSerializedTransactionForWallet({
      unsignedTransaction: action.transactionBase64,
      walletAddress: action.walletAddress,
      walletId,
    });

    await verifySignedFlashTradeTransaction({
      unsignedTransactionBase64: action.transactionBase64,
      signedTransactionBase64: signedTransaction,
      intent,
    });

    const result = await sendAndConfirmFlashTradeTransaction({
      signedTransactionBase64: signedTransaction,
    });

    void presentWalletTransactionEventNotification({
      identifier: `wallet-transaction-${action.network}-${result.signature}`,
      type: 'send',
      amountLabel: formatFlashNotificationAmount(action),
      signature: result.signature,
    });

    await invalidateAfterTransfer({
      queryClient,
      walletAddress: action.walletAddress,
      network: action.network,
      isNormalRoute: true,
    });

    updateAction(action.id, {
      status: 'submitted',
      signature: result.signature,
      errorMessage: null,
    });

    showToast({
      title: 'Flash Trade succeeded',
      message: `${action.actionLabel}: ${action.marketSymbol}`,
      variant: 'success',
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to submit Flash Trade transaction.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Flash Trade failed', message, variant: 'error' });
  }
}
