/**
 * Yuga chat tab. The actual screen implementation lives under
 * `components/features/chat/ChatScreen` to keep this route file thin.
 */

import React from 'react';

import { ChatScreen } from '@/components/features/chat/ChatScreen';

export default function ChatRoute(): React.JSX.Element {
  return <ChatScreen />;
}
