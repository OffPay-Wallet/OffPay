/**
 * Renders the scrollable message list for an active conversation. Empty
 * state (action tiles + intro) is rendered by the parent screen so this
 * file stays focused on bubble rendering.
 */

import React from 'react';
import { View } from 'react-native';

import type { AgenticChatAction, AgenticChatMessage } from '@/store/agenticChatStore';

import { ChatMessageBubble } from './ChatMessageBubble';
import { messageStyles as styles } from './styles/message';

interface ChatMessageListProps {
  messages: readonly AgenticChatMessage[];
  actionsById: ReadonlyMap<string, AgenticChatAction>;
  onConfirmPrivateSend: (action: AgenticChatAction) => void;
  onCancelPrivateSend: (action: AgenticChatAction) => void;
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
