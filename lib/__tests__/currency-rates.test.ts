import {
  formatCompactFiatCurrency,
  formatFiatCurrency,
  parseFormattedFiatCurrency,
} from '@/lib/currency-rates';

describe('currency-rates formatting', () => {
  it('keeps detailed fiat labels unchanged for normal values', () => {
    expect(formatFiatCurrency(264.97013, 'USD')).toBe('$ 264.97');
    expect(formatFiatCurrency(-0, 'USD')).toBe('$ 0.00');
    expect(formatFiatCurrency(Number.NaN, 'USD')).toBe('--');
  });

  it('formats compact card values without overflowing large balances', () => {
    expect(formatCompactFiatCurrency(264.97013, 'USD')).toBe('$ 264.97');
    expect(formatCompactFiatCurrency(1_000, 'USD')).toBe('$ 1K');
    expect(formatCompactFiatCurrency(1_234.5, 'USD')).toBe('$ 1.2K');
    expect(formatCompactFiatCurrency(999_950, 'USD')).toBe('$ 1M');
    expect(formatCompactFiatCurrency(1.52e12, 'USD')).toBe('$ 1.5T');
    expect(formatCompactFiatCurrency(Number.POSITIVE_INFINITY, 'USD')).toBe('--');
  });

  it('keeps compact labels parseable by fiat text components', () => {
    expect(parseFormattedFiatCurrency(formatCompactFiatCurrency(1_234.5, 'USD'))).toEqual({
      symbol: '$',
      amount: '1.2K',
    });
  });
});
