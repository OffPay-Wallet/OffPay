const CLEAR_SINGLE_WORD_REQUESTS = new Set([
  'activity',
  'balance',
  'balances',
  'claim',
  'claims',
  'help',
  'history',
  'orders',
  'positions',
  'price',
  'prices',
  'send',
  'swap',
  'tokens',
  'trade',
  'wallet',
]);

export const UNCLEAR_AGENT_PROMPT_MESSAGE =
  'I could not read that request. Send one clear action, like "check my balance", "send 5 USDC", or "swap 1 SOL to USDC".';

export function getUnclearAgentPromptMessage(prompt: string): string | null {
  const text = prompt.trim();
  if (text.length === 0) return null;

  const compact = text.replace(/\s+/g, '');
  if (compact.length === 0) return null;
  if (isOnlyPunctuationOrSymbols(compact)) return UNCLEAR_AGENT_PROMPT_MESSAGE;
  if (isRepeatedSingleCharacter(compact)) return UNCLEAR_AGENT_PROMPT_MESSAGE;
  if (looksLikeKeyboardNoise(text)) return UNCLEAR_AGENT_PROMPT_MESSAGE;

  return null;
}

function isOnlyPunctuationOrSymbols(value: string): boolean {
  const hasAsciiLetterOrDigit = /[A-Za-z0-9]/.test(value);
  const hasNonAscii = /[^\x00-\x7F]/.test(value);
  return !hasAsciiLetterOrDigit && !hasNonAscii;
}

function isRepeatedSingleCharacter(value: string): boolean {
  if (value.length < 6) return false;
  return new Set([...value.toLowerCase()]).size === 1;
}

function looksLikeKeyboardNoise(value: string): boolean {
  const compact = value.replace(/\s+/g, '').toLowerCase();
  if (compact.length < 8) return false;
  if (/[^\x00-\x7F]/.test(compact)) return false;

  const words = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 1 && CLEAR_SINGLE_WORD_REQUESTS.has(words[0])) return false;

  const letters = compact.replace(/[^a-z]/g, '');
  if (letters.length < 8) return false;
  if (/(?:asdf|qwer|zxcv|jkl){2,}/i.test(letters)) return true;
  if (!/[aeiou]/i.test(letters) && new Set([...letters]).size >= 6) return true;

  return false;
}
