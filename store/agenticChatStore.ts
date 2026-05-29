import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/cache/mmkv-storage';

import type { OffpayNetwork } from '@/types/offpay-api';

export type AgenticChatRole = 'user' | 'assistant';

export interface AgenticChatScope {
  walletAddress: string | null;
  network: OffpayNetwork | null;
}

export interface AgenticConversation extends AgenticChatScope {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export type AgenticPrivateSendStatus =
  | 'needs_confirmation'
  | 'submitting'
  | 'submitted'
  | 'queued'
  | 'cancelled'
  | 'failed';

export interface AgenticPrivateSendAction {
  id: string;
  kind: 'private_send' | 'normal_send';
  status: AgenticPrivateSendStatus;
  walletAddress: string;
  network: OffpayNetwork;
  recipient: string;
  amount: string;
  rawAmount: string;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  tokenLogo: string | null;
  tokenDecimals: number;
  route: 'magicblock' | 'normal';
  /**
   * True when the original prompt explicitly asked to send to the active wallet
   * (for example "send to my own wallet"). Persisted so confirm-time
   * re-validation does not re-derive intent from a synthesized recap string.
   */
  selfRecipientRequested?: boolean;
  conversationId?: string | null;
  toolCallId?: string;
  createdAt: number;
  updatedAt: number;
  signature?: string | null;
  txId?: string | null;
  errorMessage?: string | null;
}

export interface AgenticChatMessage {
  id: string;
  role: AgenticChatRole;
  text: string;
  createdAt: number;
  walletAddress: string | null;
  network: OffpayNetwork | null;
  conversationId?: string | null;
  pending?: boolean;
  actionId?: string | null;
}

interface AgenticChatState {
  messages: AgenticChatMessage[];
  actions: AgenticPrivateSendAction[];
  conversations: AgenticConversation[];
  activeConversationIdByScope: Record<string, string | null>;
  createConversation: (scope: AgenticChatScope, title?: string) => string;
  setActiveConversation: (scope: AgenticChatScope, conversationId: string | null) => void;
  archiveConversation: (id: string) => void;
  unarchiveConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  addMessage: (message: AgenticChatMessage) => void;
  updateMessage: (id: string, patch: Partial<Omit<AgenticChatMessage, 'id'>>) => void;
  upsertAction: (action: AgenticPrivateSendAction) => void;
  updateAction: (id: string, patch: Partial<Omit<AgenticPrivateSendAction, 'id'>>) => void;
  clearMessages: (scope?: { walletAddress: string | null; network: OffpayNetwork | null }) => void;
}

const MAX_MESSAGES = 240;
const MAX_ACTIONS = 80;
const MAX_CONVERSATIONS = 60;

export function getAgenticConversationScopeKey(scope: AgenticChatScope): string {
  return `${scope.network ?? 'none'}:${scope.walletAddress ?? 'none'}`;
}

function createConversationId(): string {
  return `agentic-conversation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function titleFromMessage(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return 'New chat';
  return normalized.length > 56 ? `${normalized.slice(0, 53).trim()}...` : normalized;
}

function sameScope(left: AgenticChatScope, right: AgenticChatScope): boolean {
  return left.walletAddress === right.walletAddress && left.network === right.network;
}

function touchConversation(
  conversations: AgenticConversation[],
  id: string | null | undefined,
  timestamp: number,
  title?: string,
): AgenticConversation[] {
  if (id == null) return conversations;

  return conversations.map((conversation) => {
    if (conversation.id !== id) return conversation;

    return {
      ...conversation,
      title:
        conversation.title === 'New chat' && title != null && title.trim().length > 0
          ? titleFromMessage(title)
          : conversation.title,
      updatedAt: Math.max(conversation.updatedAt, timestamp),
    };
  });
}

export const useAgenticChatStore = create<AgenticChatState>()(
  persist(
    (set) => ({
      messages: [],
      actions: [],
      conversations: [],
      activeConversationIdByScope: {},
      createConversation: (scope, title) => {
        const id = createConversationId();
        const now = Date.now();
        const conversation: AgenticConversation = {
          id,
          title: titleFromMessage(title ?? ''),
          walletAddress: scope.walletAddress,
          network: scope.network,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        };
        const scopeKey = getAgenticConversationScopeKey(scope);

        set((state) => ({
          conversations: [
            conversation,
            ...state.conversations.filter((item) => item.id !== id),
          ].slice(0, MAX_CONVERSATIONS),
          activeConversationIdByScope: {
            ...state.activeConversationIdByScope,
            [scopeKey]: id,
          },
        }));

        return id;
      },
      setActiveConversation: (scope, conversationId) =>
        set((state) => ({
          activeConversationIdByScope: {
            ...state.activeConversationIdByScope,
            [getAgenticConversationScopeKey(scope)]: conversationId,
          },
        })),
      archiveConversation: (id) =>
        set((state) => {
          const conversation = state.conversations.find((item) => item.id === id);
          if (conversation == null) return state;

          const nextActiveByScope = { ...state.activeConversationIdByScope };
          const scopeKey = getAgenticConversationScopeKey(conversation);
          if (nextActiveByScope[scopeKey] === id) {
            nextActiveByScope[scopeKey] = null;
          }

          return {
            conversations: state.conversations.map((item) =>
              item.id === id ? { ...item, archivedAt: Date.now(), updatedAt: Date.now() } : item,
            ),
            activeConversationIdByScope: nextActiveByScope,
          };
        }),
      unarchiveConversation: (id) =>
        set((state) => {
          const conversation = state.conversations.find((item) => item.id === id);
          if (conversation == null) return state;
          return {
            conversations: state.conversations.map((item) =>
              item.id === id ? { ...item, archivedAt: null, updatedAt: Date.now() } : item,
            ),
            activeConversationIdByScope: {
              ...state.activeConversationIdByScope,
              [getAgenticConversationScopeKey(conversation)]: id,
            },
          };
        }),
      deleteConversation: (id) =>
        set((state) => {
          const conversation = state.conversations.find((item) => item.id === id);
          const nextActiveByScope = { ...state.activeConversationIdByScope };

          if (conversation != null) {
            const scopeKey = getAgenticConversationScopeKey(conversation);
            if (nextActiveByScope[scopeKey] === id) {
              nextActiveByScope[scopeKey] = null;
            }
          }

          const removedActionIds = new Set(
            state.messages
              .filter((message) => message.conversationId === id)
              .map((message) => message.actionId)
              .filter((actionId): actionId is string => typeof actionId === 'string'),
          );

          return {
            conversations: state.conversations.filter((item) => item.id !== id),
            messages: state.messages.filter((message) => message.conversationId !== id),
            actions: state.actions.filter(
              (action) => action.conversationId !== id && !removedActionIds.has(action.id),
            ),
            activeConversationIdByScope: nextActiveByScope,
          };
        }),
      addMessage: (message) =>
        set((state) => ({
          messages: [message, ...state.messages.filter((item) => item.id !== message.id)].slice(
            0,
            MAX_MESSAGES,
          ),
          conversations: touchConversation(
            state.conversations,
            message.conversationId,
            message.createdAt,
            message.role === 'user' ? message.text : undefined,
          ),
        })),
      updateMessage: (id, patch) =>
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === id ? { ...message, ...patch } : message,
          ),
        })),
      upsertAction: (action) =>
        set((state) => ({
          actions: [action, ...state.actions.filter((item) => item.id !== action.id)].slice(
            0,
            MAX_ACTIONS,
          ),
          conversations: touchConversation(
            state.conversations,
            action.conversationId,
            action.updatedAt,
          ),
        })),
      updateAction: (id, patch) =>
        set((state) => ({
          actions: state.actions.map((action) =>
            action.id === id ? { ...action, ...patch, updatedAt: Date.now() } : action,
          ),
        })),
      clearMessages: (scope) =>
        set((state) => {
          if (scope == null) {
            return {
              messages: [],
              actions: [],
              conversations: [],
              activeConversationIdByScope: {},
            };
          }

          const messages = state.messages.filter((message) => !sameScope(message, scope));
          const visibleActionIds = new Set<string>();
          for (const message of messages) {
            if (typeof message.actionId === 'string' && message.actionId.length > 0) {
              visibleActionIds.add(message.actionId);
            }
          }
          return {
            messages,
            actions: state.actions.filter((action) => {
              // Keep actions that still have a referencing message in any
              // scope, or actions whose own scope is not the cleared one
              // (so we don't take down drafts on other wallets).
              if (visibleActionIds.has(action.id)) return true;
              return action.walletAddress !== scope.walletAddress || action.network !== scope.network;
            }),
            conversations: state.conversations.filter(
              (conversation) => !sameScope(conversation, scope),
            ),
            activeConversationIdByScope: {
              ...state.activeConversationIdByScope,
              [getAgenticConversationScopeKey(scope)]: null,
            },
          };
        }),
    }),
    {
      name: 'offpay-agentic-chat',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);
