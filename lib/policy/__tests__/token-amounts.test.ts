import { decimalInputToAtomicAmount, sanitizeDecimalInput } from '@/lib/policy/token-amounts';

describe('token amount input helpers', () => {
  it('keeps manually typed digits and a trailing decimal point visible', () => {
    expect(sanitizeDecimalInput('1', 6)).toBe('1');
    expect(sanitizeDecimalInput('0.', 6)).toBe('0.');
    expect(sanitizeDecimalInput('.5', 6)).toBe('0.5');
  });

  it('accepts comma decimal input without breaking grouped pasted numbers', () => {
    expect(sanitizeDecimalInput('0,5', 6)).toBe('0.5');
    expect(sanitizeDecimalInput('1,234', 6)).toBe('1234');
    expect(sanitizeDecimalInput('1,234.56', 6)).toBe('1234.56');
  });

  it('normalizes common non-ASCII numeric keyboard digits', () => {
    expect(sanitizeDecimalInput('１２.３４', 6)).toBe('12.34');
    expect(sanitizeDecimalInput('١٢٫٣٤', 6)).toBe('12.34');
  });

  it('limits fractional precision before converting to atomic units', () => {
    expect(sanitizeDecimalInput('0.123456789', 6)).toBe('0.123456');
    expect(decimalInputToAtomicAmount('0.123456789', 6)).toBe('123456');
  });
});
