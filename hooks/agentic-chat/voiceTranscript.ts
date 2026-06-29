/**
 * Post-processes STT output for the payment-agent vocabulary. Keep this pure
 * so voice intent fixes can be tested without loading Expo audio modules.
 */

/**
 * Known abbreviations that STT engines commonly spell out letter-by-letter.
 * Keys are the spaced-out form (case-insensitive), values are the canonical
 * replacement. Order matters: longer matches come first to avoid partial hits.
 */
const SPELLED_OUT_FIXES: [RegExp, string][] = [
  [/\bD\s+U\s+S\s+D\s+C\b/gi, 'dUSDC'],
  [/\bD\s+U\s+S\s+D\s+T\b/gi, 'dUSDT'],
  [/\bD\s+U\s+S\s+D\b/gi, 'dUSD'],
  [/\bU\s+S\s+D\s+C\b/gi, 'USDC'],
  [/\bU\s+S\s+D\s+T\b/gi, 'USDT'],
  [/\bS\s+O\s+L\b/gi, 'SOL'],
  [/\bU\s+S\s+D\b/gi, 'USD'],
  [/\bE\s+T\s+H\b/gi, 'ETH'],
  [/\bB\s+T\s+C\b/gi, 'BTC'],
  [/\bN\s+F\s+T\b/gi, 'NFT'],
  [/\bO\s+T\s+P\b/gi, 'OTP'],
  [/\bU\s+P\s+I\b/gi, 'UPI'],
  [/\bU\s+R\s+L\b/gi, 'URL'],
  [/\bQ\s+R\b/gi, 'QR'],
];

const WORD_FIXES: [RegExp, string][] = [
  [/\b(\d+)\s+(?:soul|sole|saul)\b/gi, '$1 SOL'],
  [/\b(send|transfer)\s+(\d+)\s+(?:soul|sole|saul)\b/gi, '$1 $2 SOL'],
  [/\byou\s+ess\s+dee\s+see\b/gi, 'USDC'],
  [/\bdee\s+you\s+ess\s+dee\s+see\b/gi, 'dUSDC'],
  [/\bdee\s+you\s+ess\s+dee\s+tee\b/gi, 'dUSDT'],
  [/\bsolana\b/gi, 'Solana'],
  [/\bmagic\s+bloc?k\b/gi, 'MagicBlock'],
  [/\bumbra\b/gi, 'Umbra'],
  [/\b(?:umber|umbrella)\b/gi, 'Umbra'],
  [/\bvolt\b/gi, 'vault'],
  [/\b(?:un\s+shield|on\s+shield)\b/gi, 'unshield'],
  [/\b((?:list|show|display|open)\s+(?:my\s+)?)context\b/gi, '$1contacts'],
  [/\b(?:list|show|display|open)\s+contact\b/gi, '$&s'],
  [/\bcontact\s+list\b/gi, 'contacts list'],
];

export function normalizeVoiceTranscript(raw: string): string {
  let text = raw;
  for (const [pattern, replacement] of SPELLED_OUT_FIXES) {
    text = text.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of WORD_FIXES) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s{2,}/g, ' ').trim();
}
