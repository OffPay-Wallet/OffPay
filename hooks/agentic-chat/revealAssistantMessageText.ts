import { useAgenticChatStore } from '@/store/agenticChatStore';

const CHARS_PER_TICK = 3;
const TICK_MS = 18;

export type RevealAssistantMessagePatch = {
  actionId?: string;
};

/**
 * Reveals assistant copy in small chunks so the UI can show the loader and
 * text together. The proxy does not stream `agent_turn` yet; this is the
 * client-side equivalent until SSE lands for that mode.
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

  if (fullText.length === 0) {
    store.updateMessage(messageId, {
      text: '',
      pending: false,
      ...options.patch,
    });
    return;
  }

  store.updateMessage(messageId, {
    text: '',
    pending: true,
    ...options.patch,
  });

  await new Promise<void>((resolve) => {
    let index = 0;

    const finish = (text: string) => {
      store.updateMessage(messageId, {
        text,
        pending: false,
        ...options.patch,
      });
      resolve();
    };

    const tick = () => {
      if (options.signal?.aborted) {
        finish(fullText);
        return;
      }

      index = Math.min(fullText.length, index + CHARS_PER_TICK);
      const partial = fullText.slice(0, index);
      const done = index >= fullText.length;

      store.updateMessage(messageId, {
        text: partial,
        pending: !done,
        ...options.patch,
      });

      if (done) {
        resolve();
        return;
      }

      setTimeout(tick, TICK_MS);
    };

    setTimeout(tick, TICK_MS);
  });
}
