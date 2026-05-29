/**
 * Single message bubble. Renders the role meta line, the body text, and
 * the in-bubble confirmation card when an action is attached to the
 * message.
 */

import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { colors } from '@/constants/colors';

import type { AgenticChatMessage, AgenticPrivateSendAction } from '@/store/agenticChatStore';

import { PrivateSendConfirmationCard } from './PrivateSendConfirmationCard';
import { messageStyles as styles } from './styles/message';

interface ChatMessageBubbleProps {
  message: AgenticChatMessage;
  action?: AgenticPrivateSendAction;
  onConfirmPrivateSend: (action: AgenticPrivateSendAction) => void;
  onCancelPrivateSend: (action: AgenticPrivateSendAction) => void;
}

export function ChatMessageBubble({
  message,
  action,
  onConfirmPrivateSend,
  onCancelPrivateSend,
}: ChatMessageBubbleProps): React.JSX.Element {
  const fromUser = message.role === 'user';
  const hasText = message.text.trim().length > 0;

  return (
    <View style={[styles.messageRow, fromUser ? styles.messageRowUser : styles.messageRowAgent]}>
      <View style={[styles.messageBubble, fromUser ? styles.userBubble : styles.agentBubble]}>
        <View style={styles.messageHeaderRow}>
          <Text
            variant="small"
            color={fromUser ? colors.brand.whiteStream : colors.text.tertiary}
            style={styles.messageMeta}
            numberOfLines={1}
          >
            {fromUser ? 'You' : 'Yuga'}
          </Text>
          {message.pending === true ? (
            <ActivityIndicator
              size="small"
              color={fromUser ? colors.brand.whiteStream : colors.brand.deepShadow}
            />
          ) : null}
        </View>
        {hasText ? (
          <Text
            variant="body"
            color={fromUser ? colors.brand.whiteStream : colors.text.primary}
            style={styles.messageText}
          >
            {message.text}
          </Text>
        ) : null}
        {action != null ? (
          <PrivateSendConfirmationCard
            action={action}
            onConfirm={onConfirmPrivateSend}
            onCancel={onCancelPrivateSend}
          />
        ) : null}
      </View>
    </View>
  );
}
