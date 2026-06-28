/**
 * Tool-calling agent loop.
 *
 * Replaces the prior intent-extraction + hardcoded-router pipeline. The
 * model gets the conversation, decides whether to call tools, the app
 * runs the tools on-device, the model writes the final reply.
 *
 * Privacy: addresses, mints, SNS names, etc. never reach the model
 * verbatim — they go through the redaction firewall first and are
 * hydrated back when the validators run on-device.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { toOffpayNetwork } from '@/constants/networks';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import { walletCanSignWithApp } from '@/lib/wallet/wallet-capabilities';
import {
  isAgenticPaymentsProxyConfigured,
  sendAgentTurn,
} from '@/lib/agentic-payments/ai-proxy-client';
import {
  formatAgenticToolProcessingLabel,
  getAvailableAgenticModelToolSchemas,
  runAgenticTools,
  type AgenticPortfolioValuationSnapshot,
  type AgenticToolDraft,
  type AgenticToolRunnerContext,
} from '@/lib/agentic-payments/agent-tools';
import { sanitizeAssistantText } from '@/lib/agentic-payments/assistant-text';
import { hydrateAssistantToolResultPlaceholders } from '@/lib/agentic-payments/assistant-tool-placeholders';
import type { AgenticKnownWallet } from '@/lib/agentic-payments/private-send-intent';
import { buildAgenticToolResultCards } from '@/lib/agentic-payments/tool-result-cards';
import {
  runAgenticPrivacyFirewall,
  sanitizeAgentMessagesForAi,
} from '@/lib/agentic-payments/privacy-firewall';
import { getUnclearAgentPromptMessage } from '@/lib/agentic-payments/unclear-prompt';
import type { AgentMessage, AgentToolCall, AgentToolResult } from '@/lib/agentic-payments/types';
import {
  getAgenticConversationScopeKey,
  useAgenticChatStore,
  type AgenticChatMessage,
  type AgenticChatScope,
  type AgenticChatAction,
  type AgenticChatToolCard,
} from '@/store/agenticChatStore';
import type { WalletAccount } from '@/store/walletStore';
import type { WalletImportMethod } from '@/lib/wallet/secure-wallet-store';
import { useWalletStore } from '@/store/walletStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import type { CapabilitiesResponse, WalletBalanceResponse } from '@/types/offpay-api';

import {
  AGENT_HISTORY_LIMIT,
  AGENT_INTENT_PRIOR_TURNS,
} from '@/components/features/chat/constants';
import { createAgenticId, getProxyErrorMessage } from '@/components/features/chat/helpers';

import { revealAssistantMessageText } from './revealAssistantMessageText';

const MAX_TOOL_TURNS = 6;

interface UseAgenticAgentSubmitParams {
  scope: AgenticChatScope;
  scopeKey: string;
  activeConversationId: string | null;
  scopedMessages: readonly AgenticChatMessage[];
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  balance: WalletBalanceResponse | null | undefined;
  portfolioValuation?: AgenticPortfolioValuationSnapshot | null;
  resolvePortfolioValuation?: () =>
    | AgenticPortfolioValuationSnapshot
    | Promise<AgenticPortfolioValuationSnapshot | null | undefined>
    | null
    | undefined;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  knownWallets: readonly AgenticKnownWallet[];
  walletId?: string | null;
  walletImportMethod?: WalletImportMethod | null;
  /** Fired when the model asks to open payroll intake (upload/paste). */
  onPayrollIntent?: (source: 'upload' | 'paste') => void;
  /** Fired with the final assistant text reply. Use to auto-speak voice replies. */
  onReplyText?: (text: string) => void;
}

export interface UseAgenticAgentSubmitResult {
  submit: (prompt: string, replyLanguage?: string) => void;
  busy: boolean;
}

export function useAgenticAgentSubmit({
  scope,
  scopeKey,
  activeConversationId,
  scopedMessages,
  walletMode,
  canUseNetwork,
  balance,
  portfolioValuation,
  resolvePortfolioValuation,
  capabilities,
  knownWallets,
  walletId,
  walletImportMethod,
  onPayrollIntent,
  onReplyText,
}: UseAgenticAgentSubmitParams): UseAgenticAgentSubmitResult {
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  useEffect(
    () => () => {
      abortRef.current?.abort('chat screen unmounted');
    },
    [],
  );

  const submit = useCallback(
    (rawPrompt: string, replyLanguage?: string) => {
      const prompt = rawPrompt.trim();
      if (prompt.length === 0) return;
      Keyboard.dismiss();

      const promptPrivacy = runAgenticPrivacyFirewall(prompt);
      const storedPrompt = promptPrivacy.blocked ? '[Sensitive content blocked]' : prompt;
      const store = useAgenticChatStore.getState();
      const conversationId = activeConversationId ?? store.createConversation(scope, storedPrompt);

      const userMessage: AgenticChatMessage = {
        id: createAgenticId('agentic-user'),
        role: 'user',
        text: storedPrompt,
        createdAt: Date.now(),
        conversationId,
        walletAddress: scope.walletAddress,
        network: scope.network,
      };
      const assistantMessage: AgenticChatMessage = {
        id: createAgenticId('agentic-assistant'),
        role: 'assistant',
        text: '',
        createdAt: Date.now() + 1,
        conversationId,
        pending: true,
        processingLabel: 'Reading request',
        walletAddress: scope.walletAddress,
        network: scope.network,
      };
      store.addMessage(userMessage);
      store.addMessage(assistantMessage);

      if (promptPrivacy.blocked) {
        store.updateMessage(assistantMessage.id, {
          text:
            promptPrivacy.blockReason ??
            'That looks like sensitive wallet material. OffPay never needs it.',
          pending: false,
          processingLabel: null,
        });
        return;
      }

      const unclearPromptMessage = getUnclearAgentPromptMessage(prompt);
      if (unclearPromptMessage != null) {
        store.updateMessage(assistantMessage.id, {
          text: unclearPromptMessage,
          pending: false,
          processingLabel: null,
        });
        return;
      }

      if (!isAgenticPaymentsProxyConfigured()) {
        store.updateMessage(assistantMessage.id, {
          text: 'Yuga is not configured for this build.',
          pending: false,
          processingLabel: null,
        });
        return;
      }

      abortRef.current?.abort('new agent request');
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);

      const rawRequestMessages: AgentMessage[] = [...scopedMessages, userMessage]
        .filter((message) => message.text.trim().length > 0 && message.pending !== true)
        .slice(-AGENT_HISTORY_LIMIT)
        .map((message) => ({ role: message.role, content: message.text }));
      const sanitizedRequest = sanitizeAgentMessagesForAi(rawRequestMessages);
      if (sanitizedRequest.blocked) {
        store.updateMessage(assistantMessage.id, {
          text:
            sanitizedRequest.blockReason ??
            'That chat includes sensitive wallet material. Start a new prompt without it.',
          pending: false,
          processingLabel: null,
        });
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
        return;
      }

      // The "userText" passed into payment validators is the user's
      // original (non-sanitized) prompt joined with the most recent prior
      // turns so clarification-style replies still resolve. The tool
      // arguments themselves are produced by the model, so this is only
      // for intent disambiguation inside the validators.
      const recentUserTurns = scopedMessages
        .filter(
          (message) =>
            message.role === 'user' && message.pending !== true && message.text.trim().length > 0,
        )
        .slice(-AGENT_INTENT_PRIOR_TURNS)
        .map((message) => message.text);
      const userTextForTools = [...recentUserTurns, prompt].join('\n');

      void runAgentLoop({
        controller,
        scope,
        scopeKey,
        conversationId,
        assistantMessageId: assistantMessage.id,
        sanitizedMessages: sanitizedRequest.messages,
        redactions: sanitizedRequest.redactions,
        userTextForTools,
        walletMode,
        canUseNetwork,
        balance,
        portfolioValuation,
        resolvePortfolioValuation,
        capabilities,
        knownWallets,
        queryClient,
        walletId,
        walletImportMethod,
        replyLanguage,
        onPayrollIntent,
        onReplyText,
      })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            useAgenticChatStore.getState().updateMessage(assistantMessage.id, {
              text: 'The previous response was interrupted. Try again.',
              pending: false,
              processingLabel: null,
            });
            return;
          }
          useAgenticChatStore.getState().updateMessage(assistantMessage.id, {
            text: getProxyErrorMessage(error),
            pending: false,
            processingLabel: null,
          });
        })
        .finally(() => {
          if (abortRef.current === controller) abortRef.current = null;
          setBusy(false);
        });
    },
    [
      activeConversationId,
      balance,
      canUseNetwork,
      capabilities,
      knownWallets,
      onPayrollIntent,
      onReplyText,
      portfolioValuation,
      resolvePortfolioValuation,
      queryClient,
      scope,
      scopeKey,
      scopedMessages,
      walletId,
      walletImportMethod,
      walletMode,
    ],
  );

  return { submit, busy };
}

interface RunAgentLoopParams {
  controller: AbortController;
  scope: AgenticChatScope;
  scopeKey: string;
  conversationId: string;
  assistantMessageId: string;
  sanitizedMessages: AgentMessage[];
  redactions: Parameters<typeof runAgenticTools>[1]['redactions'];
  userTextForTools: string;
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  balance: WalletBalanceResponse | null | undefined;
  portfolioValuation?: AgenticPortfolioValuationSnapshot | null;
  resolvePortfolioValuation?: () =>
    | AgenticPortfolioValuationSnapshot
    | Promise<AgenticPortfolioValuationSnapshot | null | undefined>
    | null
    | undefined;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  knownWallets: readonly AgenticKnownWallet[];
  queryClient: ReturnType<typeof useQueryClient>;
  walletId?: string | null;
  walletImportMethod?: WalletImportMethod | null;
  replyLanguage?: string;
  onPayrollIntent?: (source: 'upload' | 'paste') => void;
  onReplyText?: (text: string) => void;
}

async function runAgentLoop(params: RunAgentLoopParams): Promise<void> {
  const store = useAgenticChatStore.getState();
  const conversationMessages: AgentMessage[] = [...params.sanitizedMessages];
  let pendingToolCalls: AgentToolCall[] = [];
  let pendingToolResults: AgentToolResult[] = [];
  let attachedActionId: string | null = null;
  let attachedToolCards: AgenticChatToolCard[] = [];
  const canReadUmbraVaultBalance = isOffpayFeatureAvailable(
    params.capabilities ?? null,
    'umbra.execution',
  );
  const activeWalletCanUseUmbra = walletCanSignWithApp({
    importMethod: params.walletImportMethod,
    walletAddress: params.scope.walletAddress,
  });
  const toolSchemas = getAvailableAgenticModelToolSchemas({
    network: params.scope.network,
    walletAddress: params.scope.walletAddress,
    walletId: params.walletId,
    walletMode: params.walletMode,
    canUseNetwork: params.canUseNetwork,
    canUseUmbraWallet: activeWalletCanUseUmbra,
    capabilities: params.capabilities,
  });

  for (let turnIndex = 0; turnIndex < MAX_TOOL_TURNS; turnIndex += 1) {
    const turn = await sendAgentTurn(
      {
        responseMode: 'agent_turn',
        messages: conversationMessages,
        toolSchemas,
        toolResults: pendingToolResults.length > 0 ? pendingToolResults : undefined,
        assistantToolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
        context: {
          locale: params.replyLanguage,
          network: params.scope.network ?? undefined,
          walletMode: params.walletMode,
          capabilities: {
            networkAvailable: params.canUseNetwork,
            walletBalance: isOffpayFeatureAvailable(params.capabilities ?? null, 'wallet.balance'),
            normalSend: isOffpayFeatureAvailable(params.capabilities ?? null, 'wallet.balance'),
            privateSend:
              isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.privateInitMint') &&
              isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.privateSend') &&
              isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.rpcBroadcast'),
            swap: isOffpayFeatureAvailable(params.capabilities ?? null, 'swap.normalSwap'),
            umbra:
              activeWalletCanUseUmbra &&
              canReadUmbraVaultBalance &&
              isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.umbraPrivateP2p'),
            umbraVaultBalance: activeWalletCanUseUmbra && canReadUmbraVaultBalance,
            privateBalance: activeWalletCanUseUmbra && canReadUmbraVaultBalance,
            flashTrade: params.scope.network === 'mainnet' && params.canUseNetwork,
          },
          tokenSymbols: buildSafeTokenSymbols(params.balance),
        },
      },
      { signal: params.controller.signal },
    );

    if (params.controller.signal.aborted) return;

    if (!isCurrentScope(params.scope, params.scopeKey)) {
      store.updateMessage(params.assistantMessageId, {
        text: 'The wallet or network changed during this request. Send the prompt again.',
        pending: false,
        processingLabel: null,
      });
      return;
    }

    if (turn.kind === 'agent_text') {
      const textWithToolValues = hydrateAssistantToolResultPlaceholders(
        turn.text,
        pendingToolResults,
      );
      const cleaned =
        sanitizeAssistantText(textWithToolValues, attachedActionId != null) ||
        textWithToolValues.trim();

      // Start voice synthesis immediately in parallel with text reveal
      if (cleaned.length > 0) {
        params.onReplyText?.(cleaned);
      }

      await revealAssistantMessageText(params.assistantMessageId, cleaned, {
        signal: params.controller.signal,
        patch: buildAssistantRevealPatch({
          actionId: attachedActionId,
          toolCards: attachedToolCards,
        }),
      });

      return;
    }

    // tool-calls turn — run them on-device
    store.updateMessage(params.assistantMessageId, {
      processingLabel: formatAgenticToolProcessingLabel(turn.toolCalls),
    });
    let portfolioValuation = params.portfolioValuation;
    if (
      params.resolvePortfolioValuation != null &&
      shouldResolvePortfolioValuation(turn.toolCalls)
    ) {
      try {
        portfolioValuation = (await params.resolvePortfolioValuation()) ?? portfolioValuation;
      } catch {
        portfolioValuation = params.portfolioValuation;
      }
      if (params.controller.signal.aborted) return;
    }
    const toolContext: AgenticToolRunnerContext = {
      scope: params.scope,
      walletMode: params.walletMode,
      canUseNetwork: params.canUseNetwork,
      balance: params.balance,
      portfolioValuation,
      capabilities: params.capabilities,
      knownWallets: params.knownWallets,
      redactions: params.redactions,
      userText: params.userTextForTools,
      queryClient: params.queryClient,
      signal: params.controller.signal,
      walletId: params.walletId,
      walletImportMethod: params.walletImportMethod ?? null,
    };
    const run = await runAgenticTools(turn.toolCalls, toolContext, {
      onToolStart: (toolCalls) => {
        store.updateMessage(params.assistantMessageId, {
          processingLabel: formatAgenticToolProcessingLabel(toolCalls),
        });
      },
    });

    if (run.drafts.length > 0) {
      attachedActionId = persistDraftAction({
        draft: run.drafts[0],
        conversationId: params.conversationId,
      });
    }

    attachedToolCards = [...attachedToolCards, ...buildAgenticToolResultCards(run.results)].slice(
      0,
      3,
    );

    if (run.payrollIntents.length > 0 && params.onPayrollIntent != null) {
      params.onPayrollIntent(run.payrollIntents[0].source);
    }

    pendingToolCalls = [...run.toolCalls];
    pendingToolResults = run.results;
    store.updateMessage(params.assistantMessageId, {
      processingLabel: 'Writing response',
    });
  }

  // Loop hit its budget without a final text turn.
  await revealAssistantMessageText(
    params.assistantMessageId,
    'I could not finish that in one pass. Send one clear action with the amount, token or market, and any trade details like side, leverage, collateral, and order type.',
    {
      signal: params.controller.signal,
      patch: buildAssistantRevealPatch({
        actionId: attachedActionId,
        toolCards: attachedToolCards,
      }),
    },
  );
}

function buildAssistantRevealPatch({
  actionId,
  toolCards,
}: {
  actionId: string | null;
  toolCards: readonly AgenticChatToolCard[];
}): { actionId?: string; toolCards?: AgenticChatToolCard[] } | undefined {
  if (actionId == null && toolCards.length === 0) return undefined;
  return {
    ...(actionId == null ? {} : { actionId }),
    ...(toolCards.length === 0 ? {} : { toolCards: [...toolCards] }),
  };
}

function persistDraftAction({
  draft,
  conversationId,
}: {
  draft: AgenticToolDraft;
  conversationId: string;
}): string {
  const store = useAgenticChatStore.getState();
  const now = Date.now();
  const action: AgenticChatAction =
    draft.kind === 'swap'
      ? {
          ...draft.draft,
          id: createAgenticId('agentic-swap'),
          kind: 'swap',
          status: 'needs_confirmation',
          route: draft.route,
          conversationId,
          toolCallId: createAgenticId('intent'),
          createdAt: now,
          updatedAt: now,
        }
      : draft.kind === 'flash_position'
        ? {
            ...draft.draft,
            id: createAgenticId('agentic-flash'),
            kind: 'flash_position',
            status: 'needs_confirmation',
            conversationId,
            toolCallId: createAgenticId('intent'),
            createdAt: now,
            updatedAt: now,
          }
        : draft.kind === 'umbra_vault'
          ? {
              ...draft.draft,
              id: createAgenticId('agentic-umbra-vault'),
              kind: 'umbra_vault',
              status: 'needs_confirmation',
              conversationId,
              toolCallId: createAgenticId('intent'),
              createdAt: now,
              updatedAt: now,
            }
          : {
              ...draft.draft,
              id: createAgenticId(
                draft.kind === 'normal_send' ? 'agentic-normal-send' : 'agentic-private-send',
              ),
              kind: draft.kind,
              status: 'needs_confirmation',
              route: draft.route,
              conversationId,
              toolCallId: createAgenticId('intent'),
              createdAt: now,
              updatedAt: now,
            };
  store.upsertAction(action);
  return action.id;
}

function isCurrentScope(submittedScope: AgenticChatScope, submittedScopeKey: string): boolean {
  const currentWalletAddress = useWalletStore.getState().publicKey;
  let currentNetwork: AgenticChatScope['network'] = null;
  try {
    currentNetwork = toOffpayNetwork(usePreferencesStore.getState().network);
  } catch {
    currentNetwork = null;
  }
  const currentScopeKey = getAgenticConversationScopeKey({
    walletAddress: currentWalletAddress,
    network: currentNetwork,
  });
  if (currentScopeKey === submittedScopeKey) return true;
  // submittedScope referenced for type narrowing only — the real check is
  // the scope-key comparison above.
  return (
    submittedScope.walletAddress === currentWalletAddress &&
    submittedScope.network === currentNetwork
  );
}

function shouldResolvePortfolioValuation(toolCalls: readonly AgentToolCall[]): boolean {
  return toolCalls.some((toolCall) => toolCall.name === 'get_wallet_balance');
}

function buildSafeTokenSymbols(balance: WalletBalanceResponse | null | undefined): string[] {
  const symbols = new Set<string>(['SOL']);
  for (const token of balance?.tokens ?? []) {
    const symbol = token.symbol.trim();
    if (symbol.length > 0 && symbol !== token.mint) symbols.add(symbol);
  }
  return [...symbols].slice(0, 24);
}

export type { WalletAccount };
