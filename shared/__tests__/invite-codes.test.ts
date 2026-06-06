import {
  buildInviteCode,
  calculateInviteCodeChecksum,
  getInviteCodeValidationMessage,
  normalizeInviteCodeInput,
  parseInviteCode,
} from '@/shared/invite-codes';

describe('invite code policy', () => {
  it('builds and parses invite codes with the planned format', () => {
    const code = buildInviteCode({
      segment: 'b1',
      random: 'ABCDEFGHJKLM',
    });

    const parsed = parseInviteCode(code);

    expect(code).toMatch(/^OFFPAY-B1-[A-HJ-NP-Z2-9]{12}-\d{2}$/);
    expect(parsed.valid).toBe(true);
    expect(parsed.normalizedCode).toBe(code);
    expect(parsed.parsed?.segment).toBe('B1');
    expect(parsed.parsed?.random).toBe('ABCDEFGHJKLM');
  });

  it('normalizes pasted invite codes before validation', () => {
    const code = buildInviteCode({
      segment: 'B1',
      random: 'K9X2MZQRTYLP',
    });

    expect(normalizeInviteCodeInput(`  offpay - b1 - k9x2mzqrtylp - ${code.slice(-2)}  `)).toBe(
      code,
    );
    expect(parseInviteCode(`offpay - b1 - k9x2mzqrtylp - ${code.slice(-2)}`).valid).toBe(true);
  });

  it('rejects checksum typos', () => {
    const code = buildInviteCode({
      segment: 'B1',
      random: 'ABCDEFGHJKLM',
    });
    const wrongChecksum = code.endsWith('00') ? '01' : '00';
    const invalidCode = `${code.slice(0, -2)}${wrongChecksum}`;

    const parsed = parseInviteCode(invalidCode);

    expect(calculateInviteCodeChecksum(code.slice(0, -3))).toBe(code.slice(-2));
    expect(parsed.valid).toBe(false);
    expect(parsed.reason).toBe('invalid_checksum');
    expect(getInviteCodeValidationMessage(parsed.reason)).toContain('typo');
  });

  it('rejects ambiguous characters in the random segment', () => {
    const parsed = parseInviteCode('OFFPAY-B1-ABCDEF1HJKLM-01');

    expect(parsed.valid).toBe(false);
    expect(parsed.reason).toBe('invalid_format');
  });
});
