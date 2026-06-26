export const OFFPAY_INVITE_CODE_LENGTH = 6;
export const OFFPAY_INVITE_CODE_FORMAT = 'alphanumeric_6';
export const OFFPAY_INVITE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const OFFPAY_INVITE_CODE_PATTERN = /^[A-Z0-9]{6}$/;
export const OFFPAY_INVITE_CODE_MAX_INPUT_LENGTH = 64;

export interface NormalizedInviteCode {
  code: string;
}

export type InviteCodeValidationReason = 'empty' | 'too_long' | 'invalid_format';

export interface InviteCodeValidationResult {
  valid: boolean;
  normalizedCode: string;
  parsed: NormalizedInviteCode | null;
  reason: InviteCodeValidationReason | null;
}

export function normalizeInviteCodeInput(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[–—−]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/-/g, '')
    .replace(/\s+/g, '');
}

export function buildInviteCode(params: { code: string }): string {
  const normalizedCode = normalizeInviteCodeInput(params.code);
  if (!OFFPAY_INVITE_CODE_PATTERN.test(normalizedCode)) {
    throw new Error('Invite code must be exactly 6 alphanumeric characters.');
  }

  return normalizedCode;
}

export function parseInviteCode(input: string): InviteCodeValidationResult {
  const normalizedCode = normalizeInviteCodeInput(input);

  if (normalizedCode.length === 0) {
    return {
      valid: false,
      normalizedCode,
      parsed: null,
      reason: 'empty',
    };
  }

  if (normalizedCode.length > OFFPAY_INVITE_CODE_MAX_INPUT_LENGTH) {
    return {
      valid: false,
      normalizedCode,
      parsed: null,
      reason: 'too_long',
    };
  }

  const match = OFFPAY_INVITE_CODE_PATTERN.exec(normalizedCode);
  if (match == null) {
    return {
      valid: false,
      normalizedCode,
      parsed: null,
      reason: 'invalid_format',
    };
  }

  return {
    valid: true,
    normalizedCode,
    parsed: {
      code: normalizedCode,
    },
    reason: null,
  };
}

export function getInviteCodeValidationMessage(reason: InviteCodeValidationReason | null): string {
  switch (reason) {
    case 'empty':
      return 'Enter your invite code.';
    case 'too_long':
      return 'Invite code is too long.';
    case 'invalid_format':
      return 'Enter the 6-character code.';
    default:
      return '';
  }
}
