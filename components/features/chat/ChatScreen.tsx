/**
 * Yuga chat home — entry point for the agentic payments experience.
 *
 * Layout + conversation-store wiring only. Heavy logic lives in the
 * `useAgenticAgentSubmit`, `useAgenticConfirmSend`,
 * `useAgenticPendingSweep`, and `useAgenticChatScope` hooks.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  type KeyboardEvent,
  type LayoutChangeEvent,
  Platform,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import { WalletAvatar } from '@/components/features/settings/WalletAvatar';
import { ConfirmDialogCard } from '@/components/ui/ConfirmDialogCard';
import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';
import { spacing } from '@/constants/spacing';
import { useAppToast } from '@/components/ui/AppToast';
import { useOffpayCapabilities } from '@/hooks/useOffpayCapabilities';
import { useOffpayWalletBalance } from '@/hooks/useOffpayWalletBalance';
import { useWalletModeState } from '@/hooks/useWalletModeState';
import { useAgenticAgentSubmit } from '@/hooks/agentic-chat/useAgenticAgentSubmit';
import { useAgenticChatScope } from '@/hooks/agentic-chat/useAgenticChatScope';
import { useAgenticConfirmSend } from '@/hooks/agentic-chat/useAgenticConfirmSend';
import { useAgenticPendingSweep } from '@/hooks/agentic-chat/useAgenticPendingSweep';
import { useAiChatCredits } from '@/hooks/agentic-chat/useAiChatCredits';
import { useUmbraExecution } from '@/hooks/useUmbraExecution';
import { getAvailableAgenticChatCtaIds } from '@/lib/agentic-payments/agent-tools';
import { buildAgentWalletBalanceResponse } from '@/lib/agentic-payments/safe-context';
import { walletCanSignWithApp } from '@/lib/wallet/wallet-capabilities';
import {
  type AgenticChatAction,
  type AgenticChatMessage,
  type AgenticConversation,
  type AgenticPrivateSendAction,
  useAgenticChatStore,
} from '@/store/agenticChatStore';
import { useAppStore } from '@/store/app';
import { useContactsStore } from '@/store/contactsStore';
import { useTabHistoryStore, TAB_ROUTE_HREFS } from '@/store/tabHistoryStore';
import { useWalletStore } from '@/store/walletStore';

import { ChatHeader } from './ChatHeader';
import { ChatHistoryDrawer } from './ChatHistoryDrawer';
import { ChatCtaCards } from './ChatCtaCards';
import { ChatMessageList } from './ChatMessageList';
import { ChatPromptDock } from './ChatPromptDock';
import { AgenticActionDraftSheet } from './AgenticActionDraftSheet';
import { isAgenticDraftSheetAction } from './AgenticActionCard';
import { CHAT_DRAWER_MAX_WIDTH, PROMPT_DOCK_COLLAPSED_BASE_HEIGHT } from './constants';
import { headerStyles } from './styles/header';
import {
  PayrollChatController,
  type PayrollOutcomeAnnouncement,
} from '@/components/features/payroll/PayrollChatController';
import { PayrollColumnMapSheet } from '@/components/features/payroll/PayrollColumnMapSheet';
import { PayrollPasteSheet } from '@/components/features/payroll/PayrollPasteSheet';
import { usePayrollChatIntake } from '@/hooks/payroll/usePayrollChatIntake';
import { usePayrollResume } from '@/hooks/payroll/usePayrollResume';
import { useAgenticVoice } from '@/hooks/agentic-chat/useAgenticVoice';
import { useAgenticSpeech } from '@/hooks/agentic-chat/useAgenticSpeech';
import {
  generatePayrollAgentReply,
  fallbackPayrollAgentReply,
  type PayrollAgentReplyEvent,
} from '@/lib/agentic-payments/payroll-agent-reply';
import { useOffpayPortfolioValuation } from '@/hooks/useOffpayPortfolioValuation';
import {
  buildStablecoinMetadataLookup,
  buildVisibleTokenHoldings,
} from '@/lib/api/offpay-wallet-data';
import { usePayrollStore } from '@/store/payrollStore';
import { revealAssistantMessageText } from '@/hooks/agentic-chat/revealAssistantMessageText';
import { createAgenticId } from './helpers';

import type { PayrollStageOutcome } from '@/hooks/payroll/usePayrollChatIntake';
import type { PayrollRoutePolicy } from '@/lib/payroll/payroll-types';
import type { AiChatCreditStatus } from '@/lib/agentic-payments/types';

interface ChatCreditIndicator {
  label: string;
  tone: 'ready' | 'low' | 'empty' | 'loading' | 'error';
  resetLabel?: string | null;
}

function payrollActionId(runId: string): string {
  return `payroll-action-${runId}`;
}

function isCompletePortfolioValuation(
  valuation: { expectedCount: number; pricedCount: number } | null | undefined,
): boolean {
  return (
    valuation != null &&
    (valuation.expectedCount === 0 || valuation.pricedCount >= valuation.expectedCount)
  );
}

function buildCreditIndicator(
  credits: AiChatCreditStatus | null,
  loading: boolean,
  error: string | null,
  nowMs: number,
): ChatCreditIndicator | null {
  if (credits == null) {
    if (loading) {
      return { label: AI_CREDITS_UNKNOWN_LABEL, tone: 'loading' };
    }
    if (error != null) {
      return { label: AI_CREDITS_UNKNOWN_LABEL, tone: 'error' };
    }
    return null;
  }

  const resetElapsed = credits.remaining <= 0 && credits.resetAtMs <= nowMs;
  const remaining = resetElapsed ? credits.limit : credits.remaining;
  const tone: ChatCreditIndicator['tone'] =
    remaining <= 0 ? 'empty' : remaining <= 1 ? 'low' : 'ready';

  return {
    label: `${remaining}/${credits.limit}`,
    tone,
    resetLabel: remaining <= 0 ? formatCompactCreditResetLabel(credits.resetAtMs, nowMs) : null,
  };
}

function formatCreditResetLabel(resetAtMs: number, nowMs: number): string {
  const remainingMs = Math.max(0, resetAtMs - nowMs);
  if (remainingMs <= 1_000) return 'now';

  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;

  const hours = Math.ceil(minutes / 60);
  return `in ${hours}h`;
}

function formatCompactCreditResetLabel(resetAtMs: number, nowMs: number): string {
  return formatCreditResetLabel(resetAtMs, nowMs).replace(/^in\s+/, '');
}

function formatHeaderCreditLabel(creditIndicator: ChatCreditIndicator | null): string {
  if (creditIndicator == null) return AI_CREDITS_UNKNOWN_LABEL;
  return creditIndicator.label;
}

const EMPTY_CHAT_MESSAGES: readonly AgenticChatMessage[] = [];
const EMPTY_CHAT_ACTIONS: readonly AgenticChatAction[] = [];
const AI_CREDITS_UNKNOWN_LABEL = '--/5';

export function ChatScreen(): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const previousRoute = useTabHistoryStore((s) => s.previousRoute);
  const { showToast } = useAppToast();

  const username = useAppStore((s) => s.username);
  const accountName = useWalletStore((s) => s.accountName);
  const wallets = useWalletStore((s) => s.wallets);
  const contacts = useContactsStore((s) => s.contacts);

  const { effectiveWalletMode, canUseNetwork } = useWalletModeState();
  const { mixerRegisterMutation } = useUmbraExecution();
  const capabilitiesQuery = useOffpayCapabilities({ deferUntilAfterInteractions: false });
  const balanceQuery = useOffpayWalletBalance(null, {
    deferCapabilitiesUntilAfterInteractions: false,
    eagerWithoutCapabilities: true,
  });
  const { scope, scopeKey } = useAgenticChatScope();
  useAgenticPendingSweep(scope);
  const aiCredits = useAiChatCredits(scopeKey);

  const setActiveConversation = useAgenticChatStore((s) => s.setActiveConversation);
  const deleteConversation = useAgenticChatStore((s) => s.deleteConversation);
  const deletePayrollRun = usePayrollStore((s) => s.deleteRun);
  const updateMessage = useAgenticChatStore((s) => s.updateMessage);
  const updateAction = useAgenticChatStore((s) => s.updateAction);
  const createConversation = useAgenticChatStore((s) => s.createConversation);
  const addMessage = useAgenticChatStore((s) => s.addMessage);
  const upsertAction = useAgenticChatStore((s) => s.upsertAction);

  const compact = windowWidth < 390 || windowHeight < 760 || fontScale > 1.05;
  const dense = windowWidth < 340 || fontScale > 1.18;
  const horizontalPadding = dense ? spacing.md : compact ? spacing.lg : spacing['2xl'];
  const avatarSize = dense ? 36 : compact ? 40 : 44;
  const displayName = username != null ? `@${username}` : (accountName ?? 'there');

  const [prompt, setPrompt] = useState('');
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [payrollPasteOpen, setPayrollPasteOpen] = useState(false);
  const [keyboardFrame, setKeyboardFrame] = useState<{ screenY: number } | null>(null);
  const initialPromptDockHeight =
    PROMPT_DOCK_COLLAPSED_BASE_HEIGHT + Math.max(insets.bottom, spacing.lg);
  const [promptDockHeight, setPromptDockHeight] = useState(initialPromptDockHeight);
  const [pendingDeleteConversationId, setPendingDeleteConversationId] = useState<string | null>(
    null,
  );
  const [payrollReplyPendingRunIds, setPayrollReplyPendingRunIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [creditClockMs, setCreditClockMs] = useState(Date.now());
  // Declared early so the agent-submit callback can reach payroll intake
  // without a declaration-order cycle; assigned once intake is created.
  const payrollIntakeRef = useRef<ReturnType<typeof usePayrollChatIntake> | null>(null);
  const announcePayrollStageOutcomeRef = useRef<((outcome: PayrollStageOutcome) => void) | null>(
    null,
  );
  const announcedPayrollRunIdsRef = useRef<Set<string>>(new Set());
  const payrollReplyControllersRef = useRef<Set<AbortController>>(new Set());
  const previousCreditRemainingRef = useRef<number | null>(null);
  const emptyCreditToastKeyRef = useRef<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  /** True when the last submitted message originated from voice input. */
  const voiceInputRef = useRef(false);
  const keyboardOffset = useMemo(() => {
    if (keyboardFrame == null) return 0;
    return Math.max(0, windowHeight - keyboardFrame.screenY);
  }, [keyboardFrame, windowHeight]);
  const promptBottomInset = keyboardFrame == null ? insets.bottom : spacing.xs;
  const reservedPromptDockHeight = Math.max(
    promptDockHeight,
    PROMPT_DOCK_COLLAPSED_BASE_HEIGHT + Math.max(promptBottomInset, spacing.lg),
  );
  // The composer is an overlay so the empty-state layout stays stable. Use the
  // measured dock height so multiline input and voice states never cover replies.
  const bottomPadding = keyboardOffset + reservedPromptDockHeight + spacing['2xl'];
  const creditsExhausted =
    aiCredits.credits != null &&
    aiCredits.credits.remaining <= 0 &&
    aiCredits.credits.resetAtMs > creditClockMs;
  const creditIndicator = useMemo(
    () =>
      buildCreditIndicator(aiCredits.credits, aiCredits.loading, aiCredits.error, creditClockMs),
    [aiCredits.credits, aiCredits.error, aiCredits.loading, creditClockMs],
  );

  useEffect(() => {
    if (aiCredits.credits == null || aiCredits.credits.remaining > 0) return;

    const interval = setInterval(() => {
      setCreditClockMs(Date.now());
    }, 30_000);
    return () => clearInterval(interval);
  }, [aiCredits.credits]);

  const showCreditsBlockedToast = useCallback(() => {
    const resetLabel =
      aiCredits.credits == null
        ? 'Try again after the credit window resets.'
        : `Resets ${formatCreditResetLabel(aiCredits.credits.resetAtMs, Date.now())}.`;
    showToast({
      title: 'Yuga credits used',
      message: resetLabel,
      variant: 'warning',
      notificationId: `ai-chat-credits-empty-${aiCredits.credits?.resetAtMs ?? 'unknown'}`,
    });
  }, [aiCredits.credits, showToast]);

  useEffect(() => {
    if (!creditsExhausted || aiCredits.credits == null) return;
    const toastKey = `${aiCredits.credits.resetAtMs}`;
    if (emptyCreditToastKeyRef.current === toastKey) return;
    emptyCreditToastKeyRef.current = toastKey;
    showCreditsBlockedToast();
  }, [aiCredits.credits, creditsExhausted, showCreditsBlockedToast]);

  useEffect(() => {
    const currentRemaining = aiCredits.credits?.remaining ?? null;
    const previousRemaining = previousCreditRemainingRef.current;
    previousCreditRemainingRef.current = currentRemaining;

    if (
      previousRemaining === 0 &&
      aiCredits.credits != null &&
      aiCredits.credits.remaining >= aiCredits.credits.limit
    ) {
      emptyCreditToastKeyRef.current = null;
      showToast({
        title: 'Yuga credits reset',
        message: `${aiCredits.credits.limit}/${aiCredits.credits.limit} credits are available.`,
        variant: 'success',
        notificationId: `ai-chat-credits-reset-${scopeKey}`,
      });
    }
  }, [aiCredits.credits, scopeKey, showToast]);

  const activeConversationId = useAgenticChatStore(
    (s) => s.activeConversationIdByScope[scopeKey] ?? null,
  );
  const scopedConversations = useAgenticChatStore(
    useShallow((s) =>
      s.conversations
        .filter(
          (conversation) =>
            conversation.walletAddress === scope.walletAddress &&
            conversation.network === scope.network,
        )
        .sort((left, right) => right.updatedAt - left.updatedAt),
    ),
  );
  const activeConversation = useMemo(
    () =>
      scopedConversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, scopedConversations],
  );
  const scopedMessages = useAgenticChatStore(
    useShallow((s) =>
      s.messages
        .filter(
          (message) =>
            message.walletAddress === scope.walletAddress &&
            message.network === scope.network &&
            message.conversationId === activeConversation?.id,
        )
        .sort((left, right) => left.createdAt - right.createdAt),
    ),
  );
  const latestMessage = scopedMessages[scopedMessages.length - 1] ?? null;
  const latestMessageScrollAnchor =
    latestMessage == null
      ? 'empty'
      : `${latestMessage.id}:${latestMessage.text.length}:${latestMessage.pending === true ? 1 : 0}`;
  const scopedActionIds = useMemo(() => {
    const actionIds = new Set<string>();
    for (const message of scopedMessages) {
      if (typeof message.actionId === 'string' && message.actionId.length > 0) {
        actionIds.add(message.actionId);
      }
    }
    return actionIds;
  }, [scopedMessages]);
  const scopedActions = useAgenticChatStore(
    useShallow((s) => {
      if (scopedActionIds.size === 0) return EMPTY_CHAT_ACTIONS;
      return s.actions.filter((action) => scopedActionIds.has(action.id));
    }),
  );
  const actionsById = useMemo(() => {
    const byId = new Map<string, AgenticChatAction>();
    for (const action of scopedActions) byId.set(action.id, action);
    return byId;
  }, [scopedActions]);
  const activeDraftAction = useMemo(() => {
    let latest: AgenticChatAction | null = null;
    for (const action of scopedActions) {
      if (!isAgenticDraftSheetAction(action)) continue;
      if (latest == null || action.updatedAt > latest.updatedAt) {
        latest = action;
      }
    }
    return isAgenticDraftSheetAction(latest) ? latest : null;
  }, [scopedActions]);
  const draftSheetOpen = activeDraftAction != null;
  useEffect(() => {
    if (draftSheetOpen) Keyboard.dismiss();
  }, [activeDraftAction?.id, draftSheetOpen]);
  const payrollActionRunIds = useMemo(() => {
    const runIds = new Set<string>();
    for (const action of scopedActions) {
      if (action.kind === 'payroll') runIds.add(action.runId);
    }
    return runIds;
  }, [scopedActions]);
  const drawerMessages = useAgenticChatStore(
    useShallow((s) => {
      if (!chatDrawerOpen) return EMPTY_CHAT_MESSAGES;
      return s.messages.filter(
        (message) =>
          message.walletAddress === scope.walletAddress && message.network === scope.network,
      );
    }),
  );
  const legacyMessages = useAgenticChatStore(
    useShallow((s) =>
      s.messages.filter(
        (message) =>
          message.walletAddress === scope.walletAddress &&
          message.network === scope.network &&
          message.conversationId == null,
      ),
    ),
  );

  const knownWallets = useMemo(
    () => [
      ...wallets.map((wallet) => ({
        name: wallet.name,
        address: wallet.publicKey,
        active: wallet.publicKey === scope.walletAddress,
        source: 'wallet' as const,
      })),
      ...contacts.map((contact) => ({
        name: contact.name,
        address: contact.address,
        active: contact.address === scope.walletAddress,
        source: 'contact' as const,
      })),
    ],
    [contacts, scope.walletAddress, wallets],
  );
  const activeWalletId = useWalletStore((s) => s.activeWalletId);
  const activeImportMethod = useMemo(() => {
    const active = wallets.find((wallet) => wallet.publicKey === scope.walletAddress);
    return active?.importMethod ?? null;
  }, [wallets, scope.walletAddress]);
  const activeWalletCanUseUmbra = useMemo(
    () =>
      walletCanSignWithApp({
        importMethod: activeImportMethod,
        walletAddress: scope.walletAddress,
      }),
    [activeImportMethod, scope.walletAddress],
  );
  const agentBalance = useMemo(
    () =>
      balanceQuery.data == null
        ? balanceQuery.data
        : buildAgentWalletBalanceResponse(balanceQuery.data, capabilitiesQuery.capabilities),
    [balanceQuery.data, capabilitiesQuery.capabilities],
  );
  const agentTokenMetadata = useMemo(
    () =>
      buildStablecoinMetadataLookup(capabilitiesQuery.capabilities?.offline?.supportedStablecoins),
    [capabilitiesQuery.capabilities?.offline?.supportedStablecoins],
  );
  const agentVisibleHoldings = useMemo(
    () =>
      agentBalance == null
        ? []
        : buildVisibleTokenHoldings(agentBalance, undefined, agentTokenMetadata),
    [agentBalance, agentTokenMetadata],
  );
  const agentPortfolioValuationQuery = useOffpayPortfolioValuation({
    holdings: agentVisibleHoldings,
    currency: 'USD',
    enabled:
      scope.walletAddress != null && scope.network != null && agentVisibleHoldings.length > 0,
  });
  const agentPortfolioValuationData = agentPortfolioValuationQuery.data;
  const refetchAgentPortfolioValuation = agentPortfolioValuationQuery.refetch;
  const agentPortfolioValuationRef = useRef<NonNullable<typeof agentPortfolioValuationData> | null>(
    null,
  );
  useEffect(() => {
    agentPortfolioValuationRef.current = agentPortfolioValuationData ?? null;
  }, [agentPortfolioValuationData]);
  const resolveAgentPortfolioValuation = useCallback(async () => {
    const current = agentPortfolioValuationRef.current;
    if (agentVisibleHoldings.length === 0 || isCompletePortfolioValuation(current)) {
      return current;
    }

    try {
      const result = await refetchAgentPortfolioValuation({ cancelRefetch: false });
      return result.data ?? agentPortfolioValuationRef.current;
    } catch {
      return agentPortfolioValuationRef.current;
    }
  }, [agentVisibleHoldings.length, refetchAgentPortfolioValuation]);
  const availableCtaIds = useMemo(
    () =>
      getAvailableAgenticChatCtaIds({
        network: scope.network,
        walletAddress: scope.walletAddress,
        walletId: activeWalletId,
        walletMode: effectiveWalletMode,
        canUseNetwork,
        canUseUmbraWallet: activeWalletCanUseUmbra,
        capabilities: capabilitiesQuery.capabilities,
      }),
    [
      activeWalletCanUseUmbra,
      activeWalletId,
      canUseNetwork,
      capabilitiesQuery.capabilities,
      effectiveWalletMode,
      scope.network,
      scope.walletAddress,
    ],
  );

  // Outcome read-aloud. Speaks short, sanitized status lines after a send or
  // batch-send run resolves. Silent-fail and privacy-gated inside the hook.
  const speech = useAgenticSpeech();
  const speakAgentSpeech = speech.speak;
  const stopAgentSpeech = speech.stop;
  const voiceLanguageRef = useRef<string | null>(null);

  const { submit, busy: agentBusy } = useAgenticAgentSubmit({
    scope,
    scopeKey,
    activeConversationId: activeConversation?.id ?? null,
    scopedMessages,
    walletMode: effectiveWalletMode,
    canUseNetwork,
    balance: agentBalance,
    portfolioValuation: agentPortfolioValuationData ?? null,
    resolvePortfolioValuation: resolveAgentPortfolioValuation,
    capabilities: capabilitiesQuery.capabilities,
    knownWallets,
    walletId: activeWalletId,
    walletImportMethod: activeImportMethod,
    onPayrollIntent: (source) => {
      if (source === 'upload') {
        const intake = payrollIntakeRef.current;
        if (intake == null) return;
        void intake.pickFile().then((result) => {
          if (result != null) announcePayrollStageOutcomeRef.current?.(result);
        });
      } else {
        setPayrollPasteOpen(true);
      }
    },
    onReplyText: (text) => {
      if (!voiceInputRef.current) {
        if (__DEV__) {
          console.log('[VoiceReply] skipped — not a voice submission');
        }
        return;
      }
      const language = voiceLanguageRef.current ?? undefined;
      if (__DEV__) {
        console.log(
          '[VoiceReply] auto-speaking reply:',
          text.slice(0, 60),
          language ? `[lang: ${language}]` : '',
        );
      }
      void speech.speak(text, { languageHint: language, suppressAmounts: true });
    },
  });

  const {
    confirm: confirmPrivateSend,
    cancel: cancelPrivateSend,
    changeRoute: changePrivateSendRoute,
  } = useAgenticConfirmSend({
    scope,
    walletMode: effectiveWalletMode,
    canUseNetwork,
    balance: agentBalance,
    capabilities: capabilitiesQuery.capabilities,
    knownWallets,
    walletImportMethod: activeImportMethod,
    onSpeakOutcome: (phrase) => {
      void speech.speak(phrase);
    },
  });

  const payrollIntake = usePayrollChatIntake({
    walletAddress: scope.walletAddress,
    walletId: activeWalletId,
    network: scope.network,
    importMethod: activeImportMethod,
    balance: balanceQuery.data,
    capabilities: capabilitiesQuery.capabilities,
    canUseNetwork,
  });
  const pickPayrollFile = payrollIntake.pickFile;
  const refreshPayrollRoutes = payrollIntake.refreshRoutes;
  const updatePayrollRoutePolicy = payrollIntake.updateRoutePolicy;
  // Ref so the agent-submit callback (declared earlier) can trigger intake
  // without a declaration-order cycle.
  payrollIntakeRef.current = payrollIntake;

  const payrollResume = usePayrollResume({
    walletAddress: scope.walletAddress,
    network: scope.network,
  });
  // Prefer an actively-staged run; otherwise offer the most recent resumable
  // run recovered from a prior session.
  const activePayrollRunId = payrollIntake.activeRunId ?? payrollResume.resumableRunId;
  const showActivePayrollCard =
    activePayrollRunId != null && !payrollReplyPendingRunIds.has(activePayrollRunId);
  const showTransientPayrollCard =
    activePayrollRunId != null &&
    showActivePayrollCard &&
    !payrollActionRunIds.has(activePayrollRunId);
  const hasScrollableConversationContent = scopedMessages.length > 0 || activePayrollRunId != null;

  const addPayrollAssistantMessage = useCallback(
    async (
      event: PayrollAgentReplyEvent,
      options: { conversationId?: string; actionId?: string } = {},
    ) => {
      const conversationId =
        options.conversationId ?? activeConversation?.id ?? createConversation(scope, 'Batch send');
      const messageId = createAgenticId('payroll-assistant');
      addMessage({
        id: messageId,
        role: 'assistant',
        text: '',
        pending: true,
        processingLabel: 'Writing response',
        createdAt: Date.now(),
        conversationId,
        walletAddress: scope.walletAddress,
        network: scope.network,
        actionId: options.actionId,
      });

      const controller = new AbortController();
      payrollReplyControllersRef.current.add(controller);
      try {
        const reply = await generatePayrollAgentReply(event, { signal: controller.signal });
        await revealAssistantMessageText(messageId, reply, { signal: controller.signal });
      } catch {
        if (!controller.signal.aborted) {
          await revealAssistantMessageText(messageId, fallbackPayrollAgentReply(event));
        }
      } finally {
        payrollReplyControllersRef.current.delete(controller);
      }
    },
    [activeConversation?.id, addMessage, createConversation, scope],
  );

  const announcePayrollStageOutcome = useCallback(
    (outcome: PayrollStageOutcome) => {
      if (outcome.status === 'staged') {
        if (announcedPayrollRunIdsRef.current.has(outcome.runId)) return;
        announcedPayrollRunIdsRef.current.add(outcome.runId);
        setPayrollReplyPendingRunIds((current) => new Set(current).add(outcome.runId));
        const { summary } = outcome;
        const now = Date.now();
        const conversationId = activeConversation?.id ?? createConversation(scope, 'Batch send');
        const actionId = payrollActionId(outcome.runId);
        upsertAction({
          id: actionId,
          kind: 'payroll',
          status: 'needs_confirmation',
          walletAddress: summary.walletAddress,
          network: summary.network,
          runId: outcome.runId,
          summary,
          conversationId,
          createdAt: now,
          updatedAt: now,
        });
        void addPayrollAssistantMessage(
          {
            kind: 'staged',
            recipientCount: summary.recipientCount,
            blockedCount: summary.invalidCount,
            network: summary.network,
            routePolicy: summary.routePolicy,
            requiresUmbraSetup: summary.requiresUmbraSetup,
          },
          { conversationId, actionId },
        ).finally(() => {
          setPayrollReplyPendingRunIds((current) => {
            if (!current.has(outcome.runId)) return current;
            const next = new Set(current);
            next.delete(outcome.runId);
            return next;
          });
        });
        return;
      }

      if (outcome.status === 'mapping_required') {
        void addPayrollAssistantMessage({ kind: 'mapping_required', network: scope.network });
      }
    },
    [activeConversation?.id, addPayrollAssistantMessage, createConversation, scope, upsertAction],
  );
  announcePayrollStageOutcomeRef.current = announcePayrollStageOutcome;

  useEffect(() => {
    if (payrollIntake.activeRunId == null || payrollIntake.summary == null) return;
    for (const action of scopedActions) {
      if (
        action.kind === 'payroll' &&
        action.runId === payrollIntake.activeRunId &&
        action.summary !== payrollIntake.summary
      ) {
        updateAction(action.id, { summary: payrollIntake.summary });
      }
    }
  }, [payrollIntake.activeRunId, payrollIntake.summary, scopedActions, updateAction]);

  const handleSetupUmbraForPayroll = useCallback(async () => {
    if (scope.walletAddress == null || scope.network == null) {
      Alert.alert('Connect a wallet', 'Connect a wallet before setting up Umbra batch send.');
      return;
    }
    try {
      await mixerRegisterMutation.mutateAsync({
        walletAddress: scope.walletAddress,
        walletId: activeWalletId,
        network: scope.network,
      });
      await refreshPayrollRoutes();
      showToast({
        title: 'Umbra setup complete',
        message: 'Batch send routes were refreshed.',
        variant: 'success',
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Umbra setup failed.';
      Alert.alert('Umbra setup failed', message);
    }
  }, [
    activeWalletId,
    mixerRegisterMutation,
    refreshPayrollRoutes,
    scope.network,
    scope.walletAddress,
    showToast,
  ]);

  // Track only the keyboard overlap and move the bottom dock. Resizing the
  // whole screen makes the empty-state center jump when the composer focuses.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const handleShow = (event: KeyboardEvent) => {
      setKeyboardFrame({ screenY: event.endCoordinates.screenY });
    };
    const handleHide = () => {
      setKeyboardFrame(null);
    };
    const showSub = Keyboard.addListener(showEvent, handleShow);
    const hideSub = Keyboard.addListener(hideEvent, handleHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (keyboardFrame == null || !hasScrollableConversationContent) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [hasScrollableConversationContent, keyboardFrame, keyboardOffset]);

  useEffect(() => {
    if (scopedMessages.length === 0) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [latestMessageScrollAnchor, promptDockHeight, scopedMessages.length]);

  useEffect(
    () => () => {
      for (const controller of payrollReplyControllersRef.current) {
        controller.abort('chat screen unmounted');
      }
      payrollReplyControllersRef.current.clear();
    },
    [],
  );

  // Migrate legacy messages with a missing `conversationId` once.
  useEffect(() => {
    if (legacyMessages.length === 0) return;
    const firstUserText =
      legacyMessages
        .slice()
        .sort((left, right) => left.createdAt - right.createdAt)
        .find((message) => message.role === 'user')?.text ?? 'Previous chat';
    const conversationId = createConversation(scope, firstUserText);
    for (const message of legacyMessages) {
      updateMessage(message.id, { conversationId });
      if (message.actionId != null) {
        updateAction(message.actionId, { conversationId });
      }
    }
  }, [createConversation, legacyMessages, scope, updateAction, updateMessage]);

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (trimmed.length === 0 || agentBusy) return;
    if (creditsExhausted) {
      showCreditsBlockedToast();
      return;
    }
    voiceInputRef.current = false;
    voiceLanguageRef.current = null;
    setPrompt('');
    submit(trimmed);
  }, [agentBusy, creditsExhausted, prompt, showCreditsBlockedToast, submit]);

  const voice = useAgenticVoice({
    onTranscript: (transcript, detectedLanguage) => {
      if (agentBusy) {
        // Don't trample an in-flight turn; seed the input for the user.
        voiceInputRef.current = false;
        voiceLanguageRef.current = null;
        setPrompt(transcript);
        inputRef.current?.focus();
        return;
      }
      if (creditsExhausted) {
        voiceInputRef.current = false;
        voiceLanguageRef.current = null;
        setPrompt(transcript);
        inputRef.current?.focus();
        showCreditsBlockedToast();
        return;
      }
      voiceInputRef.current = true;
      voiceLanguageRef.current = detectedLanguage ?? null;
      submit(transcript, detectedLanguage);
    },
    onError: (message) => {
      showToast({ title: 'Voice', message, variant: 'error' });
    },
  });
  const voiceState = voice.state;
  const toggleVoice = voice.toggle;

  const handleBack = useCallback(() => {
    const target =
      previousRoute !== 'index' && previousRoute !== 'chat'
        ? TAB_ROUTE_HREFS[previousRoute]
        : TAB_ROUTE_HREFS.index;
    router.navigate(target);
  }, [previousRoute, router]);

  const handleNewChat = useCallback(() => {
    setPrompt('');
    payrollIntake.reset();
    setActiveConversation(scope, null);
    setChatDrawerOpen(false);
  }, [payrollIntake, scope, setActiveConversation]);

  const handleOpenConversation = useCallback(
    (conversation: AgenticConversation) => {
      setActiveConversation(scope, conversation.id);
      setChatDrawerOpen(false);
    },
    [scope, setActiveConversation],
  );

  const handleDeleteConversation = useCallback((id: string): void => {
    setPendingDeleteConversationId(id);
  }, []);

  const handleCancelDeleteConversation = useCallback((): void => {
    setPendingDeleteConversationId(null);
  }, []);

  const handleConfirmDeleteConversation = useCallback((): void => {
    if (pendingDeleteConversationId == null) return;

    const id = pendingDeleteConversationId;
    const deletingActiveConversation = activeConversation?.id === id;
    const activePayrollRunIdAtDelete = payrollIntake.activeRunId;
    setPendingDeleteConversationId(null);
    const deletedPayrollRunIds = deleteConversation(id);
    const deletedPayrollRunIdSet = new Set(deletedPayrollRunIds);
    if (
      deletingActiveConversation &&
      activePayrollRunIdAtDelete != null &&
      !deletedPayrollRunIdSet.has(activePayrollRunIdAtDelete)
    ) {
      deletePayrollRun(activePayrollRunIdAtDelete);
      deletedPayrollRunIdSet.add(activePayrollRunIdAtDelete);
    }
    if (
      deletingActiveConversation ||
      (activePayrollRunIdAtDelete != null && deletedPayrollRunIdSet.has(activePayrollRunIdAtDelete))
    ) {
      payrollIntake.reset();
    }
    if (deletedPayrollRunIdSet.size > 0) {
      setPayrollReplyPendingRunIds((current) => {
        let changed = false;
        const next = new Set(current);
        for (const runId of deletedPayrollRunIdSet) {
          changed = next.delete(runId) || changed;
        }
        return changed ? next : current;
      });
    }
    showToast({ title: 'Chat deleted', message: 'The chat was removed.', variant: 'info' });
  }, [
    activeConversation?.id,
    deleteConversation,
    deletePayrollRun,
    payrollIntake,
    pendingDeleteConversationId,
    showToast,
  ]);

  const canSubmit = prompt.trim().length > 0 && !agentBusy && !creditsExhausted;
  const draftSheetBottomOffset = draftSheetOpen
    ? Math.max(insets.bottom, spacing.lg)
    : keyboardOffset + reservedPromptDockHeight + spacing.sm;
  const draftSheetMaxHeight = Math.max(
    180,
    Math.min(480, windowHeight - draftSheetBottomOffset - insets.top - spacing['2xl']),
  );
  const hiddenComposerBottomPadding = Math.max(insets.bottom, spacing.lg);
  const scrollBottomPadding =
    (draftSheetOpen ? hiddenComposerBottomPadding : bottomPadding) +
    (activeDraftAction == null ? 0 : Math.min(draftSheetMaxHeight, 360));
  const showEmptyState =
    scopedMessages.length === 0 &&
    activePayrollRunId == null &&
    payrollIntake.error == null &&
    payrollIntake.mappingRequest == null;
  const handleCtaPrompt = useCallback(
    (nextPrompt: string) => {
      if (agentBusy) return;
      if (creditsExhausted) {
        showCreditsBlockedToast();
        return;
      }
      voiceInputRef.current = false;
      voiceLanguageRef.current = null;
      setPrompt('');
      submit(nextPrompt);
    },
    [agentBusy, creditsExhausted, showCreditsBlockedToast, submit],
  );
  const handlePromptDockLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    setPromptDockHeight((currentHeight) =>
      Math.abs(currentHeight - nextHeight) > 1 ? nextHeight : currentHeight,
    );
  }, []);
  const handleContentSizeChange = useCallback(() => {
    if (!hasScrollableConversationContent) return;
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [hasScrollableConversationContent]);
  const handleOpenChatHistory = useCallback(() => {
    setChatDrawerOpen(true);
  }, []);
  const handleCloseChatHistory = useCallback(() => {
    setChatDrawerOpen(false);
  }, []);
  const handleConfirmPrivateSend = useCallback(
    (action: AgenticChatAction) => {
      void confirmPrivateSend(action);
    },
    [confirmPrivateSend],
  );
  const handleChangePrivateSendRoute = useCallback(
    (action: AgenticPrivateSendAction, route: AgenticPrivateSendAction['route']) => {
      void changePrivateSendRoute(action, route);
    },
    [changePrivateSendRoute],
  );
  const handlePayrollRoutePolicyChange = useCallback(
    (policy: PayrollRoutePolicy) => {
      void updatePayrollRoutePolicy(policy);
    },
    [updatePayrollRoutePolicy],
  );
  const handleSpeakPayrollOutcome = useCallback(
    (phrase: string) => {
      void speakAgentSpeech(phrase, { payrollMode: true });
    },
    [speakAgentSpeech],
  );
  const handleAnnouncePayrollOutcome = useCallback(
    (outcome: PayrollOutcomeAnnouncement) => {
      void addPayrollAssistantMessage({
        kind: 'outcome',
        status: outcome.status,
        totalCount: outcome.progress.total,
        sentCount: outcome.progress.done,
        failedCount: outcome.progress.failed,
        blockedCount: outcome.progress.blocked,
        claimsPending: outcome.claimsPending,
        network: outcome.network,
      });
    },
    [addPayrollAssistantMessage],
  );
  const handleUploadPayrollFile = useCallback(() => {
    void pickPayrollFile().then((result) => {
      if (result != null) announcePayrollStageOutcome(result);
    });
  }, [announcePayrollStageOutcome, pickPayrollFile]);
  const handleOpenPayrollPaste = useCallback(() => {
    setPayrollPasteOpen(true);
  }, []);
  const handleVoicePress = useCallback(() => {
    if (voiceState === 'idle') stopAgentSpeech();
    toggleVoice();
  }, [stopAgentSpeech, toggleVoice, voiceState]);

  return (
    <View style={headerStyles.container}>
      <ChatHeader
        topInset={insets.top}
        horizontalPadding={horizontalPadding}
        onBack={handleBack}
        onOpenHistory={handleOpenChatHistory}
      />

      <View style={headerStyles.chatBody}>
        <ScrollView
          ref={scrollRef}
          style={headerStyles.chatScroll}
          contentContainerStyle={[
            headerStyles.scrollContent,
            { paddingHorizontal: horizontalPadding, paddingBottom: scrollBottomPadding },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={handleContentSizeChange}
        >
          <View style={headerStyles.welcomeRow}>
            <View
              style={[
                headerStyles.welcomeAvatar,
                { width: avatarSize + 12, height: avatarSize + 12 },
              ]}
            >
              <WalletAvatar size={avatarSize} solidFill />
            </View>
            <View style={headerStyles.welcomeText}>
              <Text
                color={colors.text.secondary}
                style={headerStyles.welcomeEyebrow}
                numberOfLines={1}
              >
                Hey there
              </Text>
              <Text
                color={colors.text.primary}
                style={headerStyles.welcomeName}
                numberOfLines={1}
                ellipsizeMode="tail"
                adjustsFontSizeToFit
                minimumFontScale={0.86}
                maxFontSizeMultiplier={1.05}
              >
                {displayName}
              </Text>
              <Text
                selectable
                color={
                  creditIndicator?.tone === 'empty' ? colors.semantic.error : colors.text.secondary
                }
                style={[
                  headerStyles.welcomeCredits,
                  creditIndicator?.tone === 'low' && headerStyles.welcomeCreditsLow,
                  creditIndicator?.tone === 'empty' && headerStyles.welcomeCreditsEmpty,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
                maxFontSizeMultiplier={1.05}
              >
                {formatHeaderCreditLabel(creditIndicator)} credits left
                {creditIndicator?.resetLabel != null
                  ? ` · resets ${creditIndicator.resetLabel}`
                  : ''}
              </Text>
            </View>
          </View>

          {payrollIntake.error != null ? (
            <View style={headerStyles.payrollErrorWrap}>
              <Text variant="caption" color={colors.semantic.error}>
                {payrollIntake.error}
              </Text>
            </View>
          ) : null}

          {showEmptyState && availableCtaIds.length > 0 ? (
            <View style={headerStyles.emptyCtaWrap}>
              <ChatCtaCards
                ctaIds={availableCtaIds}
                compact={compact}
                disabled={agentBusy || payrollIntake.busy || creditsExhausted}
                onSelect={handleCtaPrompt}
              />
            </View>
          ) : null}

          {scopedMessages.length > 0 || activePayrollRunId != null ? (
            <View style={headerStyles.messageBottomAnchor} />
          ) : null}

          {scopedMessages.length > 0 ? (
            <ChatMessageList
              messages={scopedMessages}
              actionsById={actionsById}
              onConfirmPrivateSend={handleConfirmPrivateSend}
              onCancelPrivateSend={cancelPrivateSend}
              onChangePrivateSendRoute={handleChangePrivateSendRoute}
              activePayrollRunId={payrollIntake.activeRunId}
              walletId={activeWalletId}
              payrollSummary={payrollIntake.summary}
              payrollSetupBusy={mixerRegisterMutation.isPending}
              onSetupPayrollUmbra={handleSetupUmbraForPayroll}
              onRefreshPayrollRoutes={refreshPayrollRoutes}
              onPayrollRoutePolicyChange={handlePayrollRoutePolicyChange}
              onSpeakPayrollOutcome={handleSpeakPayrollOutcome}
              onAnnouncePayrollOutcome={handleAnnouncePayrollOutcome}
            />
          ) : null}

          {activePayrollRunId != null && showTransientPayrollCard ? (
            <View style={headerStyles.payrollCardWrap}>
              <PayrollChatController
                runId={activePayrollRunId}
                walletId={activeWalletId}
                summary={payrollIntake.activeRunId != null ? payrollIntake.summary : null}
                onSetupUmbra={handleSetupUmbraForPayroll}
                onRefreshRoutes={
                  payrollIntake.activeRunId != null ? refreshPayrollRoutes : undefined
                }
                onRoutePolicyChange={handlePayrollRoutePolicyChange}
                onSpeakOutcome={handleSpeakPayrollOutcome}
                onAnnounceOutcome={handleAnnouncePayrollOutcome}
                setupBusy={mixerRegisterMutation.isPending}
              />
            </View>
          ) : null}
        </ScrollView>
      </View>

      {!draftSheetOpen ? (
        <ChatPromptDock
          inputRef={inputRef}
          prompt={prompt}
          busy={agentBusy}
          canSubmit={canSubmit}
          bottomInset={promptBottomInset}
          keyboardOffset={keyboardOffset}
          horizontalPadding={horizontalPadding}
          onLayout={handlePromptDockLayout}
          onChangeText={setPrompt}
          onSubmit={handleSubmit}
          onUpload={handleUploadPayrollFile}
          onUploadLongPress={handleOpenPayrollPaste}
          onPastePayroll={handleOpenPayrollPaste}
          uploadBusy={payrollIntake.busy}
          voice={{
            state: voice.state,
            transcript: voice.transcript,
            level: voice.level,
            onPress: handleVoicePress,
            onAccept: voice.accept,
            onCancel: voice.cancel,
          }}
          speech={{
            state: speech.state,
            muted: speech.muted,
            onStop: stopAgentSpeech,
            onToggleMuted: speech.toggleMuted,
          }}
        />
      ) : null}

      <AgenticActionDraftSheet
        action={activeDraftAction}
        bottomOffset={draftSheetBottomOffset}
        horizontalPadding={horizontalPadding}
        maxHeight={draftSheetMaxHeight}
        onConfirm={handleConfirmPrivateSend}
        onCancel={cancelPrivateSend}
        onRouteChange={handleChangePrivateSendRoute}
      />

      <PayrollPasteSheet
        visible={payrollPasteOpen}
        busy={payrollIntake.busy}
        error={payrollIntake.error}
        onClose={() => setPayrollPasteOpen(false)}
        onSubmit={async (fileName, text) => {
          const result = await payrollIntake.stageFromText(fileName, text);
          announcePayrollStageOutcome(result);
          if (result.status === 'staged' || result.status === 'mapping_required') {
            setPayrollPasteOpen(false);
            return true;
          }
          return false;
        }}
      />

      {payrollIntake.mappingRequest != null ? (
        <PayrollColumnMapSheet
          visible
          busy={payrollIntake.busy}
          headers={payrollIntake.mappingRequest.headers}
          sampleRows={payrollIntake.mappingRequest.sampleRows}
          suggestedMapping={payrollIntake.mappingRequest.suggestedMapping}
          onClose={payrollIntake.cancelMapping}
          onSubmit={(mapping) => {
            void payrollIntake.stageWithMapping(mapping).then(announcePayrollStageOutcome);
          }}
        />
      ) : null}

      <ChatHistoryDrawer
        visible={chatDrawerOpen}
        conversations={scopedConversations}
        messages={drawerMessages}
        activeConversationId={activeConversation?.id ?? null}
        width={Math.min(CHAT_DRAWER_MAX_WIDTH, Math.round(windowWidth * 0.88))}
        topInset={insets.top}
        bottomInset={insets.bottom}
        onClose={handleCloseChatHistory}
        onNewChat={handleNewChat}
        onOpenConversation={handleOpenConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      <ConfirmDialogCard
        visible={pendingDeleteConversationId != null}
        title="Delete chat?"
        message="This removes the chat from this device."
        confirmLabel="Delete"
        destructive
        onCancel={handleCancelDeleteConversation}
        onConfirm={handleConfirmDeleteConversation}
      />
    </View>
  );
}
