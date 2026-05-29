/**
 * Sweep stranded `pending: true` assistant bubbles on mount.
 *
 * The chat store is MMKV-persisted; if a previous session was aborted
 * (screen unmount, app backgrounded mid-flight) the in-flight assistant
 * message gets stuck with `pending: true` forever. Clear them once on
 * mount per scope so users do not see a permanent spinner on a bubble
 * that will never receive a response.
 */

import { useEffect } from 'react';

import {
  useAgenticChatStore,
  type AgenticChatScope,
} from '@/store/agenticChatStore';

export function useAgenticPendingSweep(scope: AgenticChatScope): void {
  // Read the current set of messages once via the store ref so this hook
  // can run a single sweep on mount without subscribing to every store
  // change.
  useEffect(() => {
    const state = useAgenticChatStore.getState();
    const stranded = state.messages.filter(
      (message) =>
        message.pending === true &&
        message.role === 'assistant' &&
        message.walletAddress === scope.walletAddress &&
        message.network === scope.network &&
        message.text.trim().length === 0,
    );
    for (const message of stranded) {
      state.updateMessage(message.id, {
        pending: false,
        text: 'The previous response was interrupted. Try again.',
      });
    }
  }, [scope.network, scope.walletAddress]);
}
