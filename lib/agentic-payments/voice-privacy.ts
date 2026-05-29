const SOLANA_OR_TX_PATTERN = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,88}(?![1-9A-HJ-NP-Za-km-z])/g;
const PRECISE_AMOUNT_PATTERN = /\b\d+\.\d{5,}\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SOLANA_OR_TX_TEST_PATTERN = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,88}(?![1-9A-HJ-NP-Za-km-z])/;
const PRECISE_AMOUNT_TEST_PATTERN = /\b\d+\.\d{5,}\b/;
const EMAIL_TEST_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export function sanitizeTextForCloudTts(text: string): string {
  return text
    .replace(EMAIL_PATTERN, '[email]')
    .replace(SOLANA_OR_TX_PATTERN, '[wallet reference]')
    .replace(PRECISE_AMOUNT_PATTERN, '[exact amount]')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canUseCloudTtsForText(text: string): boolean {
  const sanitized = sanitizeTextForCloudTts(text);
  return (
    sanitized.length > 0 &&
    !SOLANA_OR_TX_TEST_PATTERN.test(sanitized) &&
    !PRECISE_AMOUNT_TEST_PATTERN.test(sanitized) &&
    !EMAIL_TEST_PATTERN.test(sanitized)
  );
}
