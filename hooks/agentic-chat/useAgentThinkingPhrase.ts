import { useEffect, useState } from 'react';

import { pickRandomThinkingPhrase } from '@/components/features/chat/agent-thinking-phrases';

const ROTATE_MS = 2_800;

export function useAgentThinkingPhrase(active: boolean): string {
  const [phrase, setPhrase] = useState(pickRandomThinkingPhrase);

  useEffect(() => {
    if (!active) return;

    setPhrase(pickRandomThinkingPhrase());
    const timer = setInterval(() => {
      setPhrase(pickRandomThinkingPhrase());
    }, ROTATE_MS);

    return () => clearInterval(timer);
  }, [active]);

  return phrase;
}
