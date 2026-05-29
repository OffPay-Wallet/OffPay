/**
 * Renders the scrollable message list for an active conversation. Empty
 * state (action tiles + intro) is rendered by the parent screen so this
 * file stays focused on bubble rendering.
 */

import React from 'react';
import { View } from 'react-native';

import type { AgenticChatMessage, AgenticPrivateSendAction } from '@/store/agenticChatStore';

import { ChatMessageBubble } from './ChatMessageBubble';
import { messageStyles as styles } from './styles/message';

interface ChatMessageListProps {
  messages: readonly AgenticChatMessage[];
  actionsById: ReadonlyMap<string, AgenticPrivateSendAction>;
  onConfirmPrivateSend: (action: AgenticPrivateSendAction) => void;
  onCancelPrivateSend: (action: AgenticPrivateSendAction) => void;
}

export function ChatMessageList({
  messages,
  actionsById,
  onConfirmPrivateSend,
  onCancelPrivateSend,
}: ChatMessageListProps): React.JSX.Element {
  return (
    <View style={styles.messageList}>
      {messages.map((message) => (
        <ChatMessageBubble
          key={message.id}
          message={message}
          action={message.actionId != null ? actionsById.get(message.actionId) : undefined}
          onConfirmPrivateSend={onConfirmPrivateSend}
          onCancelPrivateSend={onCancelPrivateSend}
        />
      ))}
    </View>
  );
}
