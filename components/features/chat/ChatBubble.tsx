/**
 * Native B&W chat bubble shell — asymmetric corners like iMessage.
 */

import React, { type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { messageStyles as styles } from './styles/message';

export type ChatBubbleVariant = 'user' | 'agent';

interface ChatBubbleProps {
  variant: ChatBubbleVariant;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function ChatBubble({ variant, children, style }: ChatBubbleProps): React.JSX.Element {
  return (
    <View
      style={[
        styles.chatBubble,
        variant === 'user' ? styles.chatBubbleUser : styles.chatBubbleAgent,
        style,
      ]}
    >
      {children}
    </View>
  );
}
