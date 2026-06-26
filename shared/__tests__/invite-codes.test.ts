import {
  buildInviteCode,
  getInviteCodeValidationMessage,
  normalizeInviteCodeInput,
  parseInviteCode,
} from '@/shared/invite-codes';

describe('invite code policy', () => {
  it('builds and parses six-character alphanumeric invite codes', () => {
    const code = buildInviteCode({
      code: 'a1b2c3',
    });

    const parsed = parseInviteCode(code);

    expect(code).toBe('A1B2C3');
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    expect(parsed.valid).toBe(true);
    expect(parsed.normalizedCode).toBe(code);
    expect(parsed.parsed?.code).toBe('A1B2C3');
  });

  it('normalizes pasted invite codes before validation', () => {
    const code = buildInviteCode({
      code: 'K9X2MZ',
    });

    expect(normalizeInviteCodeInput('  k9 x2-mz  ')).toBe(code);
    expect(parseInviteCode('k9 x2-mz').valid).toBe(true);
  });

  it('rejects codes that are not exactly six alphanumeric characters', () => {
    const parsed = parseInviteCode('ABC12');

    expect(parsed.valid).toBe(false);
    expect(parsed.reason).toBe('invalid_format');
    expect(getInviteCodeValidationMessage(parsed.reason)).toContain('6-character');
  });
});
