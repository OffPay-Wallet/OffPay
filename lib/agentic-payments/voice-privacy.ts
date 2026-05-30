const SOLANA_OR_TX_PATTERN = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,88}(?![1-9A-HJ-NP-Za-km-z])/g;
const PRECISE_AMOUNT_PATTERN = /\b\d+\.\d{5,}\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SOLANA_OR_TX_TEST_PATTERN = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,88}(?![1-9A-HJ-NP-Za-km-z])/;
const PRECISE_AMOUNT_TEST_PATTERN = /\b\d+\.\d{5,}\b/;
const EMAIL_TEST_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

// Payroll mode also suppresses plain currency/token amounts that the
// precise-decimal pattern misses, e.g. "5000 USDC", "5,000.00 USDT",
// "$5000", or "12 SOL". General chat ("you have 5000 USDC") is rewritten
// rather than blocked, so the assistant can still speak naturally without
// reciting exact payroll figures aloud.
const TOKEN_AMOUNT_PATTERN = /\b\d[\d,]*(?:\.\d+)?\s?(?:USDC|USDT|SOL)\b/gi;
const TOKEN_AMOUNT_TEST_PATTERN = /\b\d[\d,]*(?:\.\d+)?\s?(?:USDC|USDT|SOL)\b/i;
const CURRENCY_AMOUNT_PATTERN = /(?:\$|USD\s?)\d[\d,]*(?:\.\d+)?\b/gi;
const CURRENCY_AMOUNT_TEST_PATTERN = /(?:\$|USD\s?)\d[\d,]*(?:\.\d+)?\b/i;

export interface CloudTtsSanitizeOptions {
  /**
   * Suppresses plain currency/token amounts in addition to the default
   * address/email/high-precision-decimal redaction. Use for payroll and
   * any flow where speaking exact totals aloud is undesirable.
   */
  payrollMode?: boolean;
}

export function sanitizeTextForCloudTts(
  text: string,
  options: CloudTtsSanitizeOptions = {},
): string {
  let sanitized = text
    .replace(EMAIL_PATTERN, '[email]')
    .replace(SOLANA_OR_TX_PATTERN, '[wallet reference]')
    .replace(PRECISE_AMOUNT_PATTERN, '[exact amount]');

  if (options.payrollMode === true) {
    sanitized = sanitized
      .replace(CURRENCY_AMOUNT_PATTERN, '[amount]')
      .replace(TOKEN_AMOUNT_PATTERN, '[amount]');
  }

  return sanitized.replace(/\s+/g, ' ').trim();
}

export function canUseCloudTtsForText(
  text: string,
  options: CloudTtsSanitizeOptions = {},
): boolean {
  const sanitized = sanitizeTextForCloudTts(text, options);
  if (sanitized.length === 0) return false;
  if (
    SOLANA_OR_TX_TEST_PATTERN.test(sanitized) ||
    PRECISE_AMOUNT_TEST_PATTERN.test(sanitized) ||
    EMAIL_TEST_PATTERN.test(sanitized)
  ) {
    return false;
  }
  if (
    options.payrollMode === true &&
    (TOKEN_AMOUNT_TEST_PATTERN.test(sanitized) || CURRENCY_AMOUNT_TEST_PATTERN.test(sanitized))
  ) {
    return false;
  }
  return true;
}
