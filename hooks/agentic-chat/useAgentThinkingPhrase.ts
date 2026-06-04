import { useEffect, useState } from 'react';

import {
  DEFAULT_AGENT_THINKING_PHRASE,
  pickRandomThinkingPhrase,
} from '@/components/features/chat/agent-thinking-phrases';

const ROTATE_MS = 2_800;
const DOT_MS = 420;

export function useAgentThinkingPhrase(active: boolean): string {
  const [phrase, setPhrase] = useState(DEFAULT_AGENT_THINKING_PHRASE);
  const [dotCount, setDotCount] = useState(3);

  useEffect(() => {
    if (!active) return;

    setPhrase(DEFAULT_AGENT_THINKING_PHRASE);
    const phraseTimer = setInterval(() => {
      setPhrase(pickRandomThinkingPhrase());
    }, ROTATE_MS);
    const dotTimer = setInterval(() => {
      setDotCount((current) => (current >= 3 ? 1 : current + 1));
    }, DOT_MS);

    return () => {
      clearInterval(phraseTimer);
      clearInterval(dotTimer);
    };
  }, [active]);

  return `${phrase}${'.'.repeat(dotCount)}`;
}
