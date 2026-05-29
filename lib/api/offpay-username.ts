const OFFPAY_USERNAME_MIN_LENGTH = 3;
export const OFFPAY_USERNAME_MAX_LENGTH = 8;

const USERNAME_ALLOWED_PATTERN = /^[a-z0-9_]+$/;

export function sanitizeOffpayUsernameInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, OFFPAY_USERNAME_MAX_LENGTH);
}

export function getOffpayUsernameError(value: string): string | null {
  const username = sanitizeOffpayUsernameInput(value);

  if (username.length < OFFPAY_USERNAME_MIN_LENGTH) {
    return `Use at least ${OFFPAY_USERNAME_MIN_LENGTH} characters.`;
  }

  if (!USERNAME_ALLOWED_PATTERN.test(username)) {
    return 'Use letters, numbers, and underscores only.';
  }

  return null;
}

export function formatOffpayUsername(value: string | null | undefined): string | null {
  const username = value == null ? '' : sanitizeOffpayUsernameInput(value);
  return username.length >= OFFPAY_USERNAME_MIN_LENGTH ? username : null;
}

export function sanitizeBleDisplayName(value: string | null | undefined): string | null {
  const username = formatOffpayUsername(value);
  if (username == null) return null;

  return username.slice(0, OFFPAY_USERNAME_MAX_LENGTH);
}
