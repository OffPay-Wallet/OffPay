/** Short status lines shown while Yuga is thinking (no labels, loader + vibe). */
export const AGENT_THINKING_PHRASES = [
  'hold up…',
  'cooking…',
  'let me lock in',
  'one sec bestie',
  'lowkey thinking',
  'getting the tea',
  'on it fr',
  'brain loading…',
  'vibing on that',
  'say less, checking',
  'no cap, one moment',
  'running it back',
  'bet, gimme a sec',
  'this is giving… thinking',
  'main character moment',
  'touch grass later — working',
  'rent free in my head rn',
  'its giving spreadsheet energy',
  'slay wait',
  'ok ok ok…',
] as const;

export function pickRandomThinkingPhrase(): string {
  const index = Math.floor(Math.random() * AGENT_THINKING_PHRASES.length);
  return AGENT_THINKING_PHRASES[index] ?? AGENT_THINKING_PHRASES[0];
}
