/** Short status lines shown while Yuga is processing wallet-safe work. */
export const AGENT_THINKING_PHRASES = [
  'locked in on this',
  'checking wallet context',
  'reading balances',
  'finding a clean route',
  'validating the move',
  'scanning send options',
  'checking network fees',
  'building a safe plan',
  'routing this',
  'on it',
  'pulling payment context',
  'checking token support',
  'verifying recipient',
  'lining up the next step',
  'reading swap options',
  'keeping it wallet-safe',
  'checking private routes',
  'matching the best rail',
  'one sec, routing',
  'say less, verifying',
] as const;

export function pickRandomThinkingPhrase(): string {
  const index = Math.floor(Math.random() * AGENT_THINKING_PHRASES.length);
  return AGENT_THINKING_PHRASES[index] ?? AGENT_THINKING_PHRASES[0];
}
