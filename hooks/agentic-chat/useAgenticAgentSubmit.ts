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

import { toOffpayNetwork } from '@/constants/networks';
import { isOffpayFeatureAvailable } from '@/lib/api/offpay-capabilities';
import {
  isAgenticPaymentsProxyConfigured,
  sendAgentTurn,
} from '@/lib/agentic-payments/ai-proxy-client';
import {
  AGENTIC_TOOL_SCHEMAS,
  runAgenticTools,
  type AgenticToolDraft,
  type AgenticToolRunnerContext,
} from '@/lib/agentic-payments/agent-tools';
import { sanitizeAssistantText } from '@/lib/agentic-payments/assistant-text';
import type { AgenticKnownWallet } from '@/lib/agentic-payments/private-send-intent';
import {
  runAgenticPrivacyFirewall,
  sanitizeAgentMessagesForAi,
} from '@/lib/agentic-payments/privacy-firewall';
import type {
  AgentMessage,
  AgentToolCall,
  AgentToolResult,
} from '@/lib/agentic-payments/types';
import {
  getAgenticConversationScopeKey,
  useAgenticChatStore,
  type AgenticChatMessage,
  type AgenticChatScope,
  type AgenticPrivateSendAction,
} from '@/store/agenticChatStore';
import type { WalletAccount } from '@/store/walletStore';
import { useWalletStore } from '@/store/walletStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import type { CapabilitiesResponse, WalletBalanceResponse } from '@/types/offpay-api';

import {
  AGENT_HISTORY_LIMIT,
  AGENT_INTENT_PRIOR_TURNS,
} from '@/components/features/chat/constants';
import {
  createAgenticId,
  getProxyErrorMessage,
} from '@/components/features/chat/helpers';

const MAX_TOOL_TURNS = 4;

interface UseAgenticAgentSubmitParams {
  scope: AgenticChatScope;
  scopeKey: string;
  activeConversationId: string | null;
  scopedMessages: readonly AgenticChatMessage[];
  walletMode: 'online' | 'offline';
  canUseNetwork: boolean;
  balance: WalletBalanceResponse | null | undefined;
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  knownWallets: readonly AgenticKnownWallet[];
}

export interface UseAgenticAgentSubmitResult {
  submit: (prompt: string) => void;
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
  capabilities,
  knownWallets,
}: UseAgenticAgentSubmitParams): UseAgenticAgentSubmitResult {
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort('chat screen unmounted');
    },
    [],
  );

  const submit = useCallback(
    (rawPrompt: string) => {
      const prompt = rawPrompt.trim();
      if (prompt.length === 0) return;
      Keyboard.dismiss();

      const promptPrivacy = runAgenticPrivacyFirewall(prompt);
      const storedPrompt = promptPrivacy.blocked ? '[Sensitive content blocked]' : prompt;
      const store = useAgenticChatStore.getState();
      const conversationId =
        activeConversationId ?? store.createConversation(scope, storedPrompt);

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
        });
        return;
      }

      if (!isAgenticPaymentsProxyConfigured()) {
        store.updateMessage(assistantMessage.id, {
          text: 'Yuga is not configured for this build.',
          pending: false,
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
            message.role === 'user' &&
            message.pending !== true &&
            message.text.trim().length > 0,
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
        capabilities,
        knownWallets,
      })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            useAgenticChatStore.getState().updateMessage(assistantMessage.id, {
              text: 'The previous response was interrupted. Try again.',
              pending: false,
            });
            return;
          }
          useAgenticChatStore.getState().updateMessage(assistantMessage.id, {
            text: getProxyErrorMessage(error),
            pending: false,
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
      scope,
      scopeKey,
      scopedMessages,
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
  capabilities: CapabilitiesResponse['capabilities'] | null | undefined;
  knownWallets: readonly AgenticKnownWallet[];
}

async function runAgentLoop(params: RunAgentLoopParams): Promise<void> {
  const store = useAgenticChatStore.getState();
  const conversationMessages: AgentMessage[] = [...params.sanitizedMessages];
  let pendingToolCalls: AgentToolCall[] = [];
  let pendingToolResults: AgentToolResult[] = [];
  let attachedActionId: string | null = null;

  for (let turnIndex = 0; turnIndex < MAX_TOOL_TURNS; turnIndex += 1) {
    const turn = await sendAgentTurn(
      {
        responseMode: 'agent_turn',
        messages: conversationMessages,
        toolSchemas: [...AGENTIC_TOOL_SCHEMAS],
        toolResults: pendingToolResults.length > 0 ? pendingToolResults : undefined,
        assistantToolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
        context: {
          network: params.scope.network ?? undefined,
          walletMode: params.walletMode,
          capabilities: {
            networkAvailable: params.canUseNetwork,
            walletBalance: isOffpayFeatureAvailable(
              params.capabilities ?? null,
              'wallet.balance',
            ),
            normalSend: isOffpayFeatureAvailable(
              params.capabilities ?? null,
              'wallet.balance',
            ),
            privateSend:
              isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.privateInitMint') &&
              isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.privateSend') &&
              isOffpayFeatureAvailable(params.capabilities ?? null, 'payment.rpcBroadcast'),
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
      });
      return;
    }

    if (turn.kind === 'agent_text') {
      const cleaned =
        sanitizeAssistantText(turn.text, attachedActionId != null) || turn.text.trim();
      store.updateMessage(params.assistantMessageId, {
        text: cleaned,
        pending: false,
        ...(attachedActionId != null ? { actionId: attachedActionId } : {}),
      });
      return;
    }

    // tool-calls turn — run them on-device
    const toolContext: AgenticToolRunnerContext = {
      scope: params.scope,
      walletMode: params.walletMode,
      canUseNetwork: params.canUseNetwork,
      balance: params.balance,
      capabilities: params.capabilities,
      knownWallets: params.knownWallets,
      redactions: params.redactions,
      userText: params.userTextForTools,
    };
    const run = runAgenticTools(turn.toolCalls, toolContext);

    if (run.drafts.length > 0) {
      attachedActionId = persistDraftAction({
        draft: run.drafts[0],
        conversationId: params.conversationId,
      });
    }

    pendingToolCalls = [...turn.toolCalls];
    pendingToolResults = run.results;
  }

  // Loop hit its budget without a final text turn.
  store.updateMessage(params.assistantMessageId, {
    text: 'I needed too many tool calls for that. Try a more specific request.',
    pending: false,
    ...(attachedActionId != null ? { actionId: attachedActionId } : {}),
  });
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
  const action: AgenticPrivateSendAction = {
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
  return submittedScope.walletAddress === currentWalletAddress &&
    submittedScope.network === currentNetwork;
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
