import {
  MISSING_VALUE_PLACEHOLDER,
  PRIVACY_MASK,
  hasNumericLabel,
  resolveBalanceLabel,
  resolveFiatValueLabel,
  resolvePriceHistoryEnabled,
  resolveUnitPriceAmount,
  shouldShowPercentChange,
} from '@/components/features/home/token-row-format';

describe('token-row-format', () => {
  // Feature: token-card-redesign, Property 1: Privacy mask invariant
  describe('privacy masking', () => {
    it('masks balance and fiat value when privacy is active, regardless of input', () => {
      const balances = ['12.5', '0', '1000000.123456'];
      const fiats = ['$ 264.97', '--', '', '$ 0.00'];
      for (const balance of balances) {
        expect(resolveBalanceLabel(true, balance, 'SOL')).toBe(PRIVACY_MASK);
        expect(resolveBalanceLabel(true, balance, 'SOL')).not.toContain(balance);
      }
      for (const fiat of fiats) {
        expect(resolveFiatValueLabel(true, fiat)).toBe(PRIVACY_MASK);
      }
    });

    it('reveals the underlying values when privacy is inactive', () => {
      expect(resolveBalanceLabel(false, '12.5', 'SOL')).toBe('12.5 SOL');
    });
  });

  // Feature: token-card-redesign, Property 2: Missing fiat value placeholder
  describe('resolveFiatValueLabel (privacy inactive)', () => {
    it('passes through labels that contain a digit', () => {
      expect(resolveFiatValueLabel(false, '$ 264.97')).toBe('$ 264.97');
      expect(resolveFiatValueLabel(false, '$ 0.00')).toBe('$ 0.00');
    });

    it('returns the placeholder for labels with no digit or nullish input', () => {
      expect(resolveFiatValueLabel(false, '--')).toBe(MISSING_VALUE_PLACEHOLDER);
      expect(resolveFiatValueLabel(false, '')).toBe(MISSING_VALUE_PLACEHOLDER);
      expect(resolveFiatValueLabel(false, null)).toBe(MISSING_VALUE_PLACEHOLDER);
      expect(resolveFiatValueLabel(false, undefined)).toBe(MISSING_VALUE_PLACEHOLDER);
    });

    it('agrees with hasNumericLabel on the digit rule', () => {
      const labels = ['$ 1', 'abc', '0', '', '$ -0.01/SOL'];
      for (const label of labels) {
        const expected = hasNumericLabel(label) ? label : MISSING_VALUE_PLACEHOLDER;
        expect(resolveFiatValueLabel(false, label)).toBe(expected);
      }
    });
  });

  describe('resolveUnitPriceAmount', () => {
    it('drops the /SYMBOL suffix and keeps the fiat amount', () => {
      expect(resolveUnitPriceAmount('$ 71.82/SOL')).toBe('$ 71.82');
      expect(resolveUnitPriceAmount('$ 0.0000123/BONK')).toBe('$ 0.0000123');
    });

    it('returns null when there is no numeric price', () => {
      expect(resolveUnitPriceAmount(null)).toBeNull();
      expect(resolveUnitPriceAmount(undefined)).toBeNull();
      expect(resolveUnitPriceAmount('--')).toBeNull();
      expect(resolveUnitPriceAmount('')).toBeNull();
    });
  });

  // Feature: token-card-redesign, Property 7: Percent omitted when change is unavailable
  describe('shouldShowPercentChange', () => {
    it('is true only when a change object is present', () => {
      expect(shouldShowPercentChange({ percent: 1.2, tone: 'positive' })).toBe(true);
      expect(shouldShowPercentChange({ percent: -1.2, tone: 'negative' })).toBe(true);
      expect(shouldShowPercentChange({ percent: 0, tone: 'neutral' })).toBe(true);
      expect(shouldShowPercentChange(null)).toBe(false);
      expect(shouldShowPercentChange(undefined)).toBe(false);
    });
  });

  // Feature: token-card-redesign, Property 8: Visibility-gated enablement
  describe('resolvePriceHistoryEnabled', () => {
    it('mirrors the visible flag exactly', () => {
      expect(resolvePriceHistoryEnabled(true)).toBe(true);
      expect(resolvePriceHistoryEnabled(false)).toBe(false);
    });
  });
});
