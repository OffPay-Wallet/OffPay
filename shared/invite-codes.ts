export const OFFPAY_INVITE_CODE_PREFIX = 'OFFPAY';
export const OFFPAY_INVITE_RANDOM_LENGTH = 12;
export const OFFPAY_INVITE_CHECKSUM_LENGTH = 2;
export const OFFPAY_INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const OFFPAY_INVITE_CODE_PATTERN =
  /^OFFPAY-([A-Z0-9]{1,8})-([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12})-(\d{2})$/;

export interface NormalizedInviteCode {
  code: string;
  segment: string;
  random: string;
  checksum: string;
}

export type InviteCodeValidationReason =
  | 'empty'
  | 'too_long'
  | 'invalid_format'
  | 'invalid_checksum';

export interface InviteCodeValidationResult {
  valid: boolean;
  normalizedCode: string;
  parsed: NormalizedInviteCode | null;
  reason: InviteCodeValidationReason | null;
}

const MAX_INVITE_CODE_INPUT_LENGTH = 64;

export function normalizeInviteCodeInput(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[–—−]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '');
}

export function calculateInviteCodeChecksum(baseCode: string): string {
  const sum = baseCode.split('').reduce((total, char) => total + char.charCodeAt(0), 0);
  return String(sum % 97).padStart(OFFPAY_INVITE_CHECKSUM_LENGTH, '0');
}

export function buildInviteCode(params: { segment: string; random: string }): string {
  const segment = params.segment.trim().toUpperCase();
  const random = params.random.trim().toUpperCase();
  const base = `${OFFPAY_INVITE_CODE_PREFIX}-${segment}-${random}`;
  return `${base}-${calculateInviteCodeChecksum(base)}`;
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

  if (normalizedCode.length > MAX_INVITE_CODE_INPUT_LENGTH) {
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

  const [, segment, random, checksum] = match;
  const base = `${OFFPAY_INVITE_CODE_PREFIX}-${segment}-${random}`;
  const expectedChecksum = calculateInviteCodeChecksum(base);
  if (checksum !== expectedChecksum) {
    return {
      valid: false,
      normalizedCode,
      parsed: null,
      reason: 'invalid_checksum',
    };
  }

  return {
    valid: true,
    normalizedCode,
    parsed: {
      code: normalizedCode,
      segment,
      random,
      checksum,
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
      return 'Invalid invite code format.';
    case 'invalid_checksum':
      return 'Typo detected — check the last two digits.';
    default:
      return '';
  }
}
