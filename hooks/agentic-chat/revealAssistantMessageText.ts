import { useAgenticChatStore } from '@/store/agenticChatStore';

export type RevealAssistantMessagePatch = {
  actionId?: string;
};

/**
 * Commits assistant copy in one store update. The visual pending affordance is
 * handled by Reanimated/Lottie components; avoid JS-timer-driven text churn.
 */
export async function revealAssistantMessageText(
  messageId: string,
  fullText: string,
  options: {
    signal?: AbortSignal;
    patch?: RevealAssistantMessagePatch;
  } = {},
): Promise<void> {
  const store = useAgenticChatStore.getState();

  store.updateMessage(messageId, {
    text: fullText,
    pending: false,
    processingLabel: null,
    ...options.patch,
  });
}
