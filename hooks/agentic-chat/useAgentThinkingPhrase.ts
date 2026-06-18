import { DEFAULT_AGENT_THINKING_PHRASE } from '@/components/features/chat/agent-thinking-phrases';

export function useAgentThinkingPhrase(_active: boolean): string {
  return DEFAULT_AGENT_THINKING_PHRASE;
}
