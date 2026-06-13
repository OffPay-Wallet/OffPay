/**
 * Single chat line with native B&W bubbles. Pending assistant replies show
 * loader + rotating status copy inside an agent bubble.
 */

import React from 'react';
import { Text as RNText, View } from 'react-native';
import Animated, { Easing, FadeInUp, LinearTransition } from 'react-native-reanimated';

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
import { ChatBubble } from './ChatBubble';
import { MarkdownText } from './MarkdownText';
import { PrivateSendConfirmationCard } from './PrivateSendConfirmationCard';
import { SwapConfirmationCard } from './SwapConfirmationCard';
import { FlashPositionConfirmationCard } from './FlashPositionConfirmationCard';
import { messageStyles as styles } from './styles/message';

import type { PayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';
import type { PayrollRoutePolicy } from '@/lib/payroll/payroll-types';

const MESSAGE_ENTERING = FadeInUp.duration(170).easing(Easing.out(Easing.cubic));
const MESSAGE_LAYOUT = LinearTransition.duration(190).easing(Easing.out(Easing.cubic));

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
      <RNText style={styles.thinkingStatusText} numberOfLines={2}>
        {statusPhrase}
      </RNText>
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
  const thinkingPhrase = useAgentThinkingPhrase(showThinkingOnly);

  if (fromUser) {
    if (!hasText) return null;

    return (
      <Animated.View
        entering={MESSAGE_ENTERING}
        layout={MESSAGE_LAYOUT}
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
        entering={MESSAGE_ENTERING}
        layout={MESSAGE_LAYOUT}
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
        entering={MESSAGE_ENTERING}
        layout={MESSAGE_LAYOUT}
        style={[styles.messageRow, styles.messageRowAgent]}
      >
        <ChatBubble variant="agent">
          <AgentStreamContent text={message.text} />
        </ChatBubble>
      </Animated.View>
    );
  }

  if (!hasText && action == null) {
    return null;
  }

  return (
    <Animated.View
      entering={MESSAGE_ENTERING}
      layout={MESSAGE_LAYOUT}
      style={[styles.messageRow, styles.messageRowAgent]}
    >
      <View style={styles.agentMessageStack}>
        {hasText ? (
          <ChatBubble variant="agent">
            <MarkdownText text={message.text} variant="agent" />
          </ChatBubble>
        ) : null}
        {action != null ? (
          <Animated.View
            entering={MESSAGE_ENTERING}
            layout={MESSAGE_LAYOUT}
            style={styles.actionCardWrap}
          >
            {action.kind === 'payroll' ? (
              <PayrollChatController
                runId={action.runId}
                walletId={walletId}
                summary={action.runId === activePayrollRunId ? payrollSummary : action.summary}
                onSetupUmbra={onSetupPayrollUmbra}
                onRefreshRoutes={
                  action.runId === activePayrollRunId ? onRefreshPayrollRoutes : undefined
                }
                onRoutePolicyChange={
                  action.runId === activePayrollRunId ? onPayrollRoutePolicyChange : undefined
                }
                onSpeakOutcome={onSpeakPayrollOutcome}
                onAnnounceOutcome={onAnnouncePayrollOutcome}
                setupBusy={payrollSetupBusy}
              />
            ) : action.kind === 'swap' ? (
              <SwapConfirmationCard
                action={action}
                onConfirm={onConfirmPrivateSend}
                onCancel={onCancelPrivateSend}
              />
            ) : action.kind === 'flash_position' ? (
              <FlashPositionConfirmationCard
                action={action}
                onConfirm={onConfirmPrivateSend}
                onCancel={onCancelPrivateSend}
              />
            ) : (
              <PrivateSendConfirmationCard
                action={action}
                onConfirm={onConfirmPrivateSend}
                onCancel={onCancelPrivateSend}
                onRouteChange={onChangePrivateSendRoute}
              />
            )}
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
}
