import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStorage } from '@/lib/cache/mmkv-storage';
import {
  clearAgenticActionTransactionPayload,
  redactAgenticActionForPersistence,
} from '@/lib/agentic-payments/action-persistence';
import { usePayrollStore } from '@/store/payrollStore';

import type { PayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';
import type { FlashTradeEconomicIntent } from '@/lib/flash-trade/types';
import type {
  OffpayNetwork,
  RwaAsset,
  RwaExecuteResponse,
  RwaProvider,
  RwaProviderEnvironment,
} from '@/types/offpay-api';

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
}

export type AgenticActionStatus =
  | 'needs_confirmation'
  | 'submitting'
  | 'submitted'
  | 'queued'
  | 'cancelled'
  | 'failed';

export type AgenticFlashPositionOperation =
  | 'open_position'
  | 'close_position'
  | 'add_collateral'
  | 'remove_collateral'
  | 'place_trigger_order'
  | 'edit_trigger_order'
  | 'cancel_trigger_order'
  | 'cancel_all_trigger_orders'
  | 'reverse_position';

export interface AgenticFlashTriggerOrderSummary {
  orderType: 'take_profit' | 'stop_loss';
  triggerPrice: number;
  sizePercent: number;
}

export interface AgenticFlashPositionAction {
  id: string;
  kind: 'flash_position';
  status: AgenticActionStatus;
  operation: AgenticFlashPositionOperation;
  actionLabel: string;
  walletAddress: string;
  network: 'mainnet';
  positionKey?: string | null;
  orderId?: string | null;
  marketSymbol: string;
  side: 'long' | 'short';
  leverage: number;
  collateralUsd: number;
  inputTokenSymbol: string;
  tradeType: 'market' | 'limit';
  limitPrice?: number | null;
  entryPrice: number;
  liquidationPrice: number;
  sizeUsd: number;
  entryFeeUsd: number;
  amountUsd?: number | null;
  amountTokenSymbol?: string | null;
  exitPrice?: number | null;
  feesUsd?: number | null;
  realizedPnlUsd?: number | null;
  newLeverage?: number | null;
  newLiquidationPrice?: number | null;
  transactionBase64: string;
  /** Null for Flash V2; confirmation validates the transaction blockhash on the ER. */
  expiresAt: number | null;
  economicIntent: FlashTradeEconomicIntent;
  expectedMarketPubkeys: string[];
  expectedTriggerOrderCount?: number;
  expectedOrderSlot?: number;
  expectedIsStopLoss?: boolean;
  expectedLimitPrice?: number;
  expectedTriggerOrders?: { triggerPrice: number; isStopLoss: boolean }[];
  triggerOrders?: AgenticFlashTriggerOrderSummary[];
  requestedTriggerOrders?: AgenticFlashTriggerOrderSummary[];
  warnings?: string[];
  conversationId?: string | null;
  toolCallId?: string;
  createdAt: number;
  updatedAt: number;
  signature?: string | null;
  errorMessage?: string | null;
}

export interface AgenticFlashDepositAction {
  id: string;
  kind: 'flash_deposit';
  status: AgenticActionStatus;
  walletAddress: string;
  network: 'mainnet';
  tokenSymbol: string;
  tokenMint: string;
  tokenDecimals: number;
  amount: string;
  rawAmount: string;
  transactionBase64: string;
  warnings: string[];
  conversationId?: string | null;
  toolCallId?: string;
  createdAt: number;
  updatedAt: number;
  signature?: string | null;
  errorMessage?: string | null;
}

export interface AgenticPrivateSendAction {
  id: string;
  kind: 'private_send' | 'normal_send';
  status: AgenticActionStatus;
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
  route: 'magicblock' | 'normal' | 'umbra';
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

export type AgenticUmbraVaultOperation = 'shield' | 'unshield';

export interface AgenticUmbraVaultAction {
  id: string;
  kind: 'umbra_vault';
  status: AgenticActionStatus;
  operation: AgenticUmbraVaultOperation;
  walletAddress: string;
  network: OffpayNetwork;
  amount: string;
  rawAmount: string;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  tokenLogo: string | null;
  tokenDecimals: number;
  conversationId?: string | null;
  toolCallId?: string;
  createdAt: number;
  updatedAt: number;
  signature?: string | null;
  errorMessage?: string | null;
}

export interface AgenticUmbraClaimAction {
  id: string;
  kind: 'umbra_claim';
  status: AgenticActionStatus;
  walletAddress: string;
  network: OffpayNetwork;
  /** Exact on-device claim set. Never include these indices in model-visible results. */
  utxoInsertionIndices: number[];
  claimCount: number;
  destination: 'umbra_encrypted_balance';
  settledClaimCount?: number;
  remainingClaimCount?: number;
  conversationId?: string | null;
  toolCallId?: string;
  createdAt: number;
  updatedAt: number;
  signature?: string | null;
  errorMessage?: string | null;
}

export interface AgenticSwapAction {
  id: string;
  kind: 'swap';
  status: AgenticActionStatus;
  walletAddress: string;
  network: OffpayNetwork;
  route: 'normal';
  inputMint: string;
  inputSymbol: string;
  inputName: string;
  inputDecimals: number;
  inputAmount: string;
  inputRawAmount: string;
  outputMint: string;
  outputSymbol: string;
  outputName: string;
  outputDecimals: number;
  outputAmount: string;
  outputRawAmount: string;
  minimumOutputAmount: string;
  slippageBps: number | null;
  slippageMode: 'auto' | 'manual' | null;
  priceImpactPct: number;
  fee: string;
  routeSummary: string;
  quoteId: string;
  unsignedTransaction: string;
  expiresAt: number;
  conversationId?: string | null;
  toolCallId?: string;
  createdAt: number;
  updatedAt: number;
  signature?: string | null;
  errorMessage?: string | null;
}

interface AgenticAdvancedSwapActionBase {
  id: string;
  status: AgenticActionStatus;
  walletAddress: string;
  network: 'mainnet';
  inputMint: string;
  inputSymbol: string;
  inputName: string;
  inputDecimals: number;
  inputAmount: string;
  inputRawAmount: string;
  inputValueUsd: number;
  outputMint: string;
  outputSymbol: string;
  outputName: string;
  outputDecimals: number;
  warnings: string[];
  conversationId?: string | null;
  toolCallId?: string;
  createdAt: number;
  updatedAt: number;
  signature?: string | null;
  providerOrderId?: string | null;
  errorMessage?: string | null;
}

export interface AgenticTriggerSwapAction extends AgenticAdvancedSwapActionBase {
  kind: 'swap_trigger';
  triggerMint: string;
  triggerSymbol: string;
  triggerCondition: 'above' | 'below';
  triggerPriceUsd: number;
  referencePriceUsd: number;
  slippageBps: number;
  expiresAt: number;
}

export interface AgenticRecurringSwapAction extends AgenticAdvancedSwapActionBase {
  kind: 'swap_recurring';
  interval: 'hourly' | 'daily' | 'weekly' | 'monthly';
  orderCount: number;
  frequency: string;
  perOrderValueUsd: number;
}

export type AgenticAdvancedSwapAction = AgenticTriggerSwapAction | AgenticRecurringSwapAction;

interface AgenticAdvancedSwapCancelActionBase {
  id: string;
  status: AgenticActionStatus;
  walletAddress: string;
  network: 'mainnet';
  orderId: string;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  providerStatus: string;
  warnings: string[];
  conversationId?: string | null;
  toolCallId?: string;
  createdAt: number;
  updatedAt: number;
  signature?: string | null;
  errorMessage?: string | null;
}

export interface AgenticTriggerSwapCancelAction extends AgenticAdvancedSwapCancelActionBase {
  kind: 'swap_trigger_cancel';
}

export interface AgenticRecurringSwapCancelAction extends AgenticAdvancedSwapCancelActionBase {
  kind: 'swap_recurring_cancel';
}

export type AgenticAdvancedSwapCancelAction =
  | AgenticTriggerSwapCancelAction
  | AgenticRecurringSwapCancelAction;

export interface AgenticRwaTradeAction {
  id: string;
  kind: 'rwa_trade';
  status: AgenticActionStatus;
  walletAddress: string;
  network: OffpayNetwork;
  asset: RwaAsset;
  side: 'buy' | 'sell';
  inputAmount: string;
  cashAmount: string | null;
  quantity: string | null;
  settlementSymbol: string;
  payAmount: string;
  paySymbol: string;
  receiveAmount: string;
  receiveSymbol: string;
  priceUsd: number | null;
  priceImpactPct: number;
  fee: string;
  routeSummary: string;
  slippageBps: number | null;
  quoteId: string;
  unsignedTransaction: string;
  unsignedTransactions?: Array<{
    id: string;
    label: string;
    target: 'solana_devnet' | 'magicblock_er_devnet';
    unsignedTransaction: string;
    transactionFormat: 'solana_legacy_transaction_base64';
  }>;
  expiresAt: number | null;
  provider: RwaProvider;
  providerEnvironment: RwaProviderEnvironment;
  walletId: string | null;
  conversationId?: string | null;
  toolCallId?: string;
  createdAt: number;
  updatedAt: number;
  signature?: string | null;
  signatures?: RwaExecuteResponse['signatures'] | null;
  errorMessage?: string | null;
}

export interface AgenticPayrollAction {
  id: string;
  kind: 'payroll';
  status: AgenticActionStatus;
  walletAddress: string;
  network: OffpayNetwork;
  runId: string;
  summary: PayrollConfirmationSummary;
  conversationId?: string | null;
  createdAt: number;
  updatedAt: number;
  errorMessage?: string | null;
}

export type AgenticToolCardTone = 'default' | 'success' | 'warning' | 'danger';

export interface AgenticToolCardRow {
  label: string;
  value: string;
  tone?: AgenticToolCardTone;
  mono?: boolean;
}

export interface AgenticToolCardItem {
  title: string;
  detail?: string | null;
  tone?: AgenticToolCardTone;
}

export interface AgenticRwaAssetCardPreview {
  kind: 'rwa_asset';
  symbol: string;
  name: string;
  displayName: string;
  categoryLabel: string;
  underlyingSymbol: string | null;
  priceLabel: string;
  change24hPct: number | null;
  logoUri: string | null;
  tradable: boolean;
  settlementSymbol: string;
  holding: string | null;
}

export interface AgenticChatToolCard {
  id: string;
  toolName: string;
  title: string;
  subtitle?: string | null;
  tone?: AgenticToolCardTone;
  rows?: AgenticToolCardRow[];
  items?: AgenticToolCardItem[];
  rwaAsset?: AgenticRwaAssetCardPreview;
  footer?: string | null;
}

export type AgenticChatAction =
  | AgenticPrivateSendAction
  | AgenticUmbraVaultAction
  | AgenticUmbraClaimAction
  | AgenticSwapAction
  | AgenticAdvancedSwapAction
  | AgenticAdvancedSwapCancelAction
  | AgenticRwaTradeAction
  | AgenticPayrollAction
  | AgenticFlashDepositAction
  | AgenticFlashPositionAction;

type AgenticActionPatch =
  | Partial<Omit<AgenticPrivateSendAction, 'id'>>
  | Partial<Omit<AgenticUmbraVaultAction, 'id'>>
  | Partial<Omit<AgenticUmbraClaimAction, 'id'>>
  | Partial<Omit<AgenticSwapAction, 'id'>>
  | Partial<Omit<AgenticTriggerSwapAction, 'id'>>
  | Partial<Omit<AgenticRecurringSwapAction, 'id'>>
  | Partial<Omit<AgenticAdvancedSwapCancelAction, 'id'>>
  | Partial<Omit<AgenticRwaTradeAction, 'id'>>
  | Partial<Omit<AgenticPayrollAction, 'id'>>
  | Partial<Omit<AgenticFlashDepositAction, 'id'>>
  | Partial<Omit<AgenticFlashPositionAction, 'id'>>;

export interface AgenticChatMessage {
  id: string;
  role: AgenticChatRole;
  text: string;
  createdAt: number;
  walletAddress: string | null;
  network: OffpayNetwork | null;
  conversationId?: string | null;
  pending?: boolean;
  processingLabel?: string | null;
  actionId?: string | null;
  toolCards?: AgenticChatToolCard[];
}

interface AgenticChatState {
  messages: AgenticChatMessage[];
  actions: AgenticChatAction[];
  conversations: AgenticConversation[];
  activeConversationIdByScope: Record<string, string | null>;
  createConversation: (scope: AgenticChatScope, title?: string) => string;
  setActiveConversation: (scope: AgenticChatScope, conversationId: string | null) => void;
  deleteConversation: (id: string) => string[];
  addMessage: (message: AgenticChatMessage) => void;
  updateMessage: (id: string, patch: Partial<Omit<AgenticChatMessage, 'id'>>) => void;
  upsertAction: (action: AgenticChatAction) => void;
  updateAction: (id: string, patch: AgenticActionPatch) => void;
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

function pruneActions(
  actions: AgenticChatAction[],
  messages: readonly AgenticChatMessage[],
  pinnedActionId?: string,
): AgenticChatAction[] {
  const referencedActionIds = new Set(
    messages
      .map((message) => message.actionId)
      .filter((actionId): actionId is string => typeof actionId === 'string'),
  );
  if (pinnedActionId != null) referencedActionIds.add(pinnedActionId);
  const referenced: AgenticChatAction[] = [];
  const unreferenced: AgenticChatAction[] = [];

  for (const action of actions) {
    if (referencedActionIds.has(action.id)) referenced.push(action);
    else unreferenced.push(action);
  }

  return [...referenced, ...unreferenced].slice(0, Math.max(MAX_ACTIONS, referencedActionIds.size));
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
      deleteConversation: (id) => {
        const deletedPayrollRunIds = new Set<string>();
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

          for (const action of state.actions) {
            if (action.kind !== 'payroll') continue;
            if (action.conversationId === id || removedActionIds.has(action.id)) {
              deletedPayrollRunIds.add(action.runId);
            }
          }

          return {
            conversations: state.conversations.filter((item) => item.id !== id),
            messages: state.messages.filter((message) => message.conversationId !== id),
            actions: state.actions.filter(
              (action) => action.conversationId !== id && !removedActionIds.has(action.id),
            ),
            activeConversationIdByScope: nextActiveByScope,
          };
        });

        for (const runId of deletedPayrollRunIds) {
          usePayrollStore.getState().deleteRun(runId);
        }

        return [...deletedPayrollRunIds];
      },
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
          actions: pruneActions(
            [action, ...state.actions.filter((item) => item.id !== action.id)],
            state.messages,
            action.id,
          ),
          conversations: touchConversation(
            state.conversations,
            action.conversationId,
            action.updatedAt,
          ),
        })),
      updateAction: (id, patch) =>
        set((state) => ({
          actions: state.actions.map((action): AgenticChatAction => {
            if (action.id !== id) return action;
            const next = {
              ...action,
              ...patch,
              updatedAt: Date.now(),
            } as AgenticChatAction;
            return next.status === 'submitted' ||
              next.status === 'queued' ||
              next.status === 'cancelled' ||
              next.status === 'failed'
              ? clearAgenticActionTransactionPayload(next)
              : next;
          }),
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
              return (
                action.walletAddress !== scope.walletAddress || action.network !== scope.network
              );
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
      version: 2,
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        messages: state.messages,
        actions: state.actions.map(redactAgenticActionForPersistence),
        conversations: state.conversations,
        activeConversationIdByScope: state.activeConversationIdByScope,
      }),
      migrate: (persistedState) => {
        if (persistedState == null || typeof persistedState !== 'object') {
          return persistedState as AgenticChatState;
        }

        const state = persistedState as {
          actions?: AgenticChatAction[];
          conversations?: Array<AgenticConversation & { archivedAt?: number | null }>;
        };

        return {
          ...(persistedState as AgenticChatState),
          actions: Array.isArray(state.actions)
            ? state.actions.map(redactAgenticActionForPersistence)
            : [],
          conversations: Array.isArray(state.conversations)
            ? state.conversations
                .filter((conversation) => conversation.archivedAt == null)
                .map(({ archivedAt: _archivedAt, ...conversation }) => conversation)
            : [],
        };
      },
    },
  ),
);
