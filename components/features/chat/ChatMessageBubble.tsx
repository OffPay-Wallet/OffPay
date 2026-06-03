/**
 * Single chat line with native B&W bubbles. Pending assistant replies show
 * loader + rotating status copy inside an agent bubble.
 */

import React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { useAgentThinkingPhrase } from '@/hooks/agentic-chat/useAgentThinkingPhrase';

import type { AgenticChatAction, AgenticChatMessage } from '@/store/agenticChatStore';

import { AiLoaderLottie } from './AiLoaderLottie';
import { ChatBubble } from './ChatBubble';
import { PrivateSendConfirmationCard } from './PrivateSendConfirmationCard';
import { SwapConfirmationCard } from './SwapConfirmationCard';
import { messageStyles as styles } from './styles/message';

interface ChatMessageBubbleProps {
  message: AgenticChatMessage;
  action?: AgenticChatAction;
  onConfirmPrivateSend: (action: AgenticChatAction) => void;
  onCancelPrivateSend: (action: AgenticChatAction) => void;
}

function AgentThinkingContent({ statusPhrase }: { statusPhrase: string }): React.JSX.Element {
  return (
    <View style={styles.agentThinkingInner}>
      <View style={styles.agentLoaderSlot}>
        <AiLoaderLottie size={20} tone="onDark" accessibilityLabel={statusPhrase} />
      </View>
      <Text style={styles.thinkingStatusText} numberOfLines={2}>
        {statusPhrase}
      </Text>
    </View>
  );
}

function AgentStreamContent({ text }: { text: string }): React.JSX.Element {
  return (
    <View style={styles.agentStreamInner}>
      <View style={styles.agentLoaderSlot}>
        <AiLoaderLottie size={20} tone="onDark" />
      </View>
      <Text style={styles.streamText}>{text}</Text>
    </View>
  );
}

export function ChatMessageBubble({
  message,
  action,
  onConfirmPrivateSend,
  onCancelPrivateSend,
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
      <View style={[styles.messageRow, styles.messageRowUser]}>
        <ChatBubble variant="user">
          <Text style={styles.bubbleTextUser}>{message.text}</Text>
        </ChatBubble>
      </View>
    );
  }

  if (showThinkingOnly) {
    return (
      <View style={[styles.messageRow, styles.messageRowAgent]}>
        <ChatBubble variant="agent">
          <AgentThinkingContent statusPhrase={thinkingPhrase} />
        </ChatBubble>
      </View>
    );
  }

  if (showStreamRow) {
    return (
      <View style={[styles.messageRow, styles.messageRowAgent]}>
        <ChatBubble variant="agent">
          <AgentStreamContent text={message.text} />
        </ChatBubble>
      </View>
    );
  }

  if (!hasText && action == null) {
    return null;
  }

  return (
    <View style={[styles.messageRow, styles.messageRowAgent]}>
      <View style={styles.agentMessageStack}>
        {hasText ? (
          <ChatBubble variant="agent">
            <Text style={styles.bubbleTextAgent}>{message.text}</Text>
          </ChatBubble>
        ) : null}
        {action != null ? (
          <View style={styles.actionCardWrap}>
            {action.kind === 'swap' ? (
              <SwapConfirmationCard
                action={action}
                onConfirm={onConfirmPrivateSend}
                onCancel={onCancelPrivateSend}
              />
            ) : (
              <PrivateSendConfirmationCard
                action={action}
                onConfirm={onConfirmPrivateSend}
                onCancel={onCancelPrivateSend}
              />
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}
