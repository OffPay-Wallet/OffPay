import { useAgenticChatStore, type AgenticChatToolCard } from '@/store/agenticChatStore';

export type RevealAssistantMessagePatch = {
  actionId?: string;
  toolCards?: AgenticChatToolCard[];
};

interface RevealTypingOptions {
  intervalMs?: number;
  minChunkCharacters?: number;
}

const DEFAULT_REVEAL_INTERVAL_MS = 28;
const DEFAULT_MIN_CHUNK_CHARACTERS = 12;
const MIN_TEXT_LENGTH_FOR_TYPING = 18;

function resolveTypingOptions(
  typing: boolean | RevealTypingOptions | undefined,
): RevealTypingOptions | null {
  if (typing === false) return null;
  if (typing == null || typing === true) {
    return {
      intervalMs: DEFAULT_REVEAL_INTERVAL_MS,
      minChunkCharacters: DEFAULT_MIN_CHUNK_CHARACTERS,
    };
  }

  return {
    intervalMs: typing.intervalMs ?? DEFAULT_REVEAL_INTERVAL_MS,
    minChunkCharacters: typing.minChunkCharacters ?? DEFAULT_MIN_CHUNK_CHARACTERS,
  };
}

function buildRevealChunks(text: string, minChunkCharacters: number): string[] {
  const tokens = text.match(/\S+\s*/g);
  if (tokens == null) return text.length > 0 ? [text] : [];

  const chunks: string[] = [];
  let chunk = '';
  for (const token of tokens) {
    chunk += token;
    if (chunk.trim().length >= minChunkCharacters || /\n\s*$/.test(chunk)) {
      chunks.push(chunk);
      chunk = '';
    }
  }

  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

function waitForRevealFrame(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    function handleAbort(): void {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }

    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

/**
 * Reveals assistant copy in small word chunks so the pending bubble reads like
 * a streaming reply, then clears pending once the full text is visible.
 */
export async function revealAssistantMessageText(
  messageId: string,
  fullText: string,
  options: {
    signal?: AbortSignal;
    patch?: RevealAssistantMessagePatch;
    typing?: boolean | RevealTypingOptions;
  } = {},
): Promise<void> {
  const store = useAgenticChatStore.getState();
  const typing = resolveTypingOptions(options.typing);

  if (typing == null || fullText.length < MIN_TEXT_LENGTH_FOR_TYPING || options.signal?.aborted) {
    store.updateMessage(messageId, {
      text: fullText,
      pending: false,
      processingLabel: null,
      ...options.patch,
    });
    return;
  }

  const chunks = buildRevealChunks(fullText, Math.max(1, typing.minChunkCharacters ?? 1));
  if (chunks.length <= 1) {
    store.updateMessage(messageId, {
      text: fullText,
      pending: false,
      processingLabel: null,
      ...options.patch,
    });
    return;
  }

  let visibleText = '';
  for (const chunk of chunks) {
    if (options.signal?.aborted) break;
    visibleText += chunk;
    store.updateMessage(messageId, {
      text: visibleText,
      pending: true,
      processingLabel: null,
      ...options.patch,
    });

    if (visibleText.length < fullText.length) {
      await waitForRevealFrame(
        Math.max(0, typing.intervalMs ?? DEFAULT_REVEAL_INTERVAL_MS),
        options.signal,
      );
    }
  }

  // Preserve the previous contract: even if a signal aborts during the reveal,
  // the helper leaves the message settled instead of stranded as pending.
  store.updateMessage(messageId, {
    text: fullText,
    pending: false,
    processingLabel: null,
    ...options.patch,
  });
}
