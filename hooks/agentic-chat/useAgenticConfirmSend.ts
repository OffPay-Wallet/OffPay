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
  type AgenticChatScope,
  type AgenticPrivateSendAction,
  type AgenticSwapAction,
  type AgenticFlashPositionAction,
  type AgenticUmbraVaultAction,
} from '@/store/agenticChatStore';
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
  const addUmbraReceipt = useUmbraPrivacyStore((s) => s.addReceipt);
  const { scheduleRefresh, applyOptimisticShield, applyOptimisticCredit } =
    useUmbraCacheInvalidator();

  const cancel = useCallback(
    (action: AgenticChatAction) => {
      if (action.status !== 'needs_confirmation') return;
      updateAction(action.id, { status: 'cancelled', errorMessage: null });
    },
    [updateAction],
  );

  const changeRoute = useCallback(
    async (action: AgenticChatAction, route: AgenticPrivateSendAction['route']): Promise<void> => {
      if (!isTransferAction(action) || action.status !== 'needs_confirmation') return;
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
    async (action: AgenticChatAction): Promise<void> => {
      if (action.status !== 'needs_confirmation') return;
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
        showToast({ title: 'Confirmation blocked', message: validation.message, variant: 'error' });
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
            ? 'Yuga normal payment submitted'
            : action.route === 'umbra'
              ? 'Yuga Umbra private payment submitted'
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
          includeUmbraInvalidation: action.route === 'umbra',
        });

        updateAction(action.id, {
          status: result.status,
          signature: result.signature,
          txId: result.txId,
          errorMessage: null,
        });
        showToast({
          title: result.status === 'submitted' ? 'Yuga transfer submitted' : 'Yuga transfer queued',
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
      title: action.operation === 'shield' ? 'Umbra shield submitted' : 'Umbra withdraw submitted',
      message: amountLabel,
      variant: 'success',
    });
    onSpeakOutcome?.(
      action.operation === 'shield' ? 'Umbra shield submitted.' : 'Umbra withdraw submitted.',
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
    const { signSerializedTransactionForWallet } =
      await import('@/lib/crypto/solana-transaction-signing');
    const quote =
      action.expiresAt - Date.now() <= SWAP_QUOTE_REFRESH_BUFFER_MS
        ? await createSwapQuote({
            inputMint: action.inputMint,
            outputMint: action.outputMint,
            amount: action.inputRawAmount,
            network: action.network,
            receiverAddress: action.walletAddress,
            ...(action.slippageBps == null
              ? {}
              : {
                  slippageBps: action.slippageBps,
                  useManualSlippage: action.slippageMode === 'manual',
                }),
          })
        : {
            quoteId: action.quoteId,
            inputMint: action.inputMint,
            outputMint: action.outputMint,
            inAmount: action.inputRawAmount,
            outAmount: action.outputRawAmount,
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
    const outputAmount = formatAtomicAmount(quote.outAmount, action.outputDecimals);

    void presentWalletTransactionEventNotification({
      identifier: `wallet-transaction-${action.network}-${result.signature}`,
      type: 'swap',
      amountLabel: `+${outputAmount} ${action.outputSymbol}`,
      secondaryAmountLabel: `-${action.inputAmount} ${action.inputSymbol}`,
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
      outputRawAmount: quote.outAmount,
      outputAmount,
      expiresAt: quote.expiresAt,
      priceImpactPct: quote.priceImpactPct,
      fee: quote.fee,
      routeSummary: quote.routeSummary,
      slippageBps: quote.slippageBps ?? null,
      slippageMode: quote.slippageMode ?? null,
    });
    showToast({
      title: 'Yuga swap submitted',
      message: `${action.inputAmount} ${action.inputSymbol} → ${action.outputSymbol}`,
      variant: 'success',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to submit swap.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Yuga swap failed', message, variant: 'error' });
  }
}

function formatFlashNotificationAmount(action: AgenticFlashPositionAction): string {
  if (action.amountUsd != null) {
    return `${action.actionLabel} $${action.amountUsd.toFixed(2)}`;
  }
  return `${action.actionLabel} $${action.sizeUsd.toFixed(2)}`;
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

  if (action.expiresAt - Date.now() <= 0) {
    const message = 'Quote expired. Ask Yuga to prepare a fresh transaction.';
    updateAction(action.id, { status: 'failed', errorMessage: message });
    showToast({ title: 'Quote expired', message, variant: 'error' });
    return;
  }

  updateAction(action.id, { status: 'submitting', errorMessage: null });
  await yieldToUi();

  try {
    const { signSerializedTransactionForWallet } =
      await import('@/lib/crypto/solana-transaction-signing');
    const { broadcastRawTransaction } = await import('@/lib/api/offpay-api-client');

    const signedTransaction = await signSerializedTransactionForWallet({
      unsignedTransaction: action.transactionBase64,
      walletAddress: action.walletAddress,
      walletId,
    });

    const result = await broadcastRawTransaction({
      rawTransaction: signedTransaction,
      network: action.network,
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
      title: 'Flash Trade submitted',
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
