/** Short status lines shown while Yuga is processing wallet-safe work. */
export const AGENT_THINKING_PHRASES = [
  'Reading request',
  'Choosing the right tool',
  'Checking safely',
  'Preparing response',
] as const;

export const DEFAULT_AGENT_THINKING_PHRASE = 'Reading request';

export function pickRandomThinkingPhrase(): string {
  const index = Math.floor(Math.random() * AGENT_THINKING_PHRASES.length);
  return AGENT_THINKING_PHRASES[index] ?? DEFAULT_AGENT_THINKING_PHRASE;
}
