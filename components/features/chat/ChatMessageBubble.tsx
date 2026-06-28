/**
 * Single chat line with native B&W bubbles. Pending assistant replies show
 * loader + rotating status copy inside an agent bubble.
 */

import React from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';

import {
  PayrollChatController,
  type PayrollOutcomeAnnouncement,
} from '@/components/features/payroll/PayrollChatController';
import { useAgentThinkingPhrase } from '@/hooks/agentic-chat/useAgentThinkingPhrase';

import type {
  AgenticChatAction,
  AgenticChatMessage,
  AgenticPrivateSendAction,
} from '@/store/agenticChatStore';

import { AiLoaderLottie } from './AiLoaderLottie';
import {
  AgenticActionCard,
  isAgenticDraftSheetAction,
  isAgenticTransactionAction,
} from './AgenticActionCard';
import {
  ACTION_CARD_MORPH_EASING,
  actionCardSummaryEnter,
  actionCardSummaryExit,
} from './action-card-motion';
import { ChatBubble } from './ChatBubble';
import { MarkdownText } from './MarkdownText';
import { ProcessingShimmerText } from './ProcessingShimmerText';
import { AgenticToolResultCard } from './AgenticToolResultCard';
import { messageStyles as styles } from './styles/message';

import type { PayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';
import type { PayrollRoutePolicy } from '@/lib/payroll/payroll-types';

const MESSAGE_ENTERING = FadeInUp.duration(170).easing(Easing.out(Easing.cubic));
const MESSAGE_LAYOUT = LinearTransition.duration(190).easing(Easing.out(Easing.cubic));
const ACTION_CARD_LAYOUT = LinearTransition.duration(280).easing(ACTION_CARD_MORPH_EASING);

interface ChatMessageBubbleProps {
  message: AgenticChatMessage;
  action?: AgenticChatAction;
  onConfirmPrivateSend: (action: AgenticChatAction) => void;
  onCancelPrivateSend: (action: AgenticChatAction) => void;
  onChangePrivateSendRoute: (
    action: AgenticPrivateSendAction,
    route: AgenticPrivateSendAction['route'],
  ) => void;
  activePayrollRunId?: string | null;
  walletId: string | null;
  payrollSummary: PayrollConfirmationSummary | null;
  payrollSetupBusy?: boolean;
  onSetupPayrollUmbra?: () => void;
  onRefreshPayrollRoutes?: () => Promise<void>;
  onPayrollRoutePolicyChange?: (policy: PayrollRoutePolicy) => void;
  onSpeakPayrollOutcome?: (phrase: string) => void;
  onAnnouncePayrollOutcome?: (outcome: PayrollOutcomeAnnouncement) => void;
}

function AgentThinkingContent({ statusPhrase }: { statusPhrase: string }): React.JSX.Element {
  return (
    <View style={styles.agentThinkingInner}>
      <View style={styles.agentLoaderSlot}>
        <AiLoaderLottie size={20} tone="onDark" accessibilityLabel={statusPhrase} />
      </View>
      <ProcessingShimmerText
        text={statusPhrase}
        style={styles.thinkingStatusText}
        numberOfLines={2}
      />
    </View>
  );
}

function AgentStreamContent({ text }: { text: string }): React.JSX.Element {
  return (
    <View style={styles.agentStreamInner}>
      <View style={styles.agentLoaderSlot}>
        <AiLoaderLottie size={20} tone="onDark" />
      </View>
      <MarkdownText text={text} variant="agent" style={styles.streamText} />
    </View>
  );
}

export function ChatMessageBubble({
  message,
  action,
  onConfirmPrivateSend,
  onCancelPrivateSend,
  onChangePrivateSendRoute,
  activePayrollRunId,
  walletId,
  payrollSummary,
  payrollSetupBusy = false,
  onSetupPayrollUmbra,
  onRefreshPayrollRoutes,
  onPayrollRoutePolicyChange,
  onSpeakPayrollOutcome,
  onAnnouncePayrollOutcome,
}: ChatMessageBubbleProps): React.JSX.Element | null {
  const fromUser = message.role === 'user';
  const hasText = message.text.trim().length > 0;
  const agentPending = !fromUser && message.pending === true;
  const showThinkingOnly = agentPending && !hasText;
  const showStreamRow = agentPending && hasText;
  const fallbackThinkingPhrase = useAgentThinkingPhrase(showThinkingOnly);
  const thinkingPhrase = message.processingLabel?.trim() || fallbackThinkingPhrase;
  const visibleAction = isAgenticDraftSheetAction(action) ? undefined : action;
  const toolCards = message.toolCards ?? [];
  const hasToolCards = toolCards.length > 0;
  const reduceMotion = useReducedMotion();
  const messageEntering = reduceMotion ? undefined : MESSAGE_ENTERING;
  const messageLayout = reduceMotion ? undefined : MESSAGE_LAYOUT;
  const actionCardEntering = reduceMotion ? undefined : actionCardSummaryEnter;
  const actionCardExiting = reduceMotion ? undefined : actionCardSummaryExit;
  const actionCardLayout = reduceMotion ? undefined : ACTION_CARD_LAYOUT;

  if (fromUser) {
    if (!hasText) return null;

    return (
      <Animated.View
        entering={messageEntering}
        layout={messageLayout}
        style={[styles.messageRow, styles.messageRowUser]}
      >
        <ChatBubble variant="user">
          <MarkdownText text={message.text} variant="user" />
        </ChatBubble>
      </Animated.View>
    );
  }

  if (showThinkingOnly) {
    return (
      <Animated.View
        entering={messageEntering}
        layout={messageLayout}
        style={[styles.messageRow, styles.messageRowAgent]}
      >
        <ChatBubble variant="agent">
          <AgentThinkingContent statusPhrase={thinkingPhrase} />
        </ChatBubble>
      </Animated.View>
    );
  }

  if (showStreamRow) {
    return (
      <Animated.View
        entering={messageEntering}
        layout={messageLayout}
        style={[styles.messageRow, styles.messageRowAgent]}
      >
        <ChatBubble variant="agent">
          <AgentStreamContent text={message.text} />
        </ChatBubble>
      </Animated.View>
    );
  }

  if (!hasText && visibleAction == null && !hasToolCards) {
    return null;
  }

  const actionOnly = !hasText && visibleAction != null && !hasToolCards;
  const cardOnly = !hasText && visibleAction == null && hasToolCards;

  return (
    <Animated.View
      entering={actionOnly || cardOnly ? undefined : messageEntering}
      layout={messageLayout}
      style={[styles.messageRow, styles.messageRowAgent]}
    >
      <View style={styles.agentMessageStack}>
        {hasText ? (
          <ChatBubble variant="agent">
            <MarkdownText text={message.text} variant="agent" />
          </ChatBubble>
        ) : null}
        {hasToolCards
          ? toolCards.map((card) => (
              <Animated.View
                key={card.id}
                entering={actionCardEntering}
                exiting={actionCardExiting}
                layout={actionCardLayout}
                style={styles.toolCardWrap}
              >
                <AgenticToolResultCard card={card} />
              </Animated.View>
            ))
          : null}
        {visibleAction != null ? (
          <Animated.View
            entering={actionCardEntering}
            exiting={actionCardExiting}
            layout={actionCardLayout}
            style={styles.actionCardWrap}
          >
            {visibleAction.kind === 'payroll' ? (
              <PayrollChatController
                runId={visibleAction.runId}
                walletId={walletId}
                summary={
                  visibleAction.runId === activePayrollRunId
                    ? payrollSummary
                    : visibleAction.summary
                }
                onSetupUmbra={onSetupPayrollUmbra}
                onRefreshRoutes={
                  visibleAction.runId === activePayrollRunId ? onRefreshPayrollRoutes : undefined
                }
                onRoutePolicyChange={
                  visibleAction.runId === activePayrollRunId
                    ? onPayrollRoutePolicyChange
                    : undefined
                }
                onSpeakOutcome={onSpeakPayrollOutcome}
                onAnnounceOutcome={onAnnouncePayrollOutcome}
                setupBusy={payrollSetupBusy}
              />
            ) : isAgenticTransactionAction(visibleAction) ? (
              <AgenticActionCard
                action={visibleAction}
                onConfirm={onConfirmPrivateSend}
                onCancel={onCancelPrivateSend}
                onRouteChange={onChangePrivateSendRoute}
              />
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
}
