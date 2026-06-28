import { colors } from '@/constants/colors';
import {
  formatPercentChange,
  toneColor,
  type ChangeTone,
} from '@/lib/ui/token-change-format';

describe('token-change-format', () => {
  // Feature: token-card-redesign, Property 4: Percent sign formatting
  describe('formatPercentChange', () => {
    it('prefixes positive values with "+" and keeps two decimals', () => {
      expect(formatPercentChange(2.4)).toBe('+2.40%');
      expect(formatPercentChange(0.78)).toBe('+0.78%');
    });

    it('keeps the native "-" sign for negative values', () => {
      expect(formatPercentChange(-0.78)).toBe('-0.78%');
      expect(formatPercentChange(-1.05)).toBe('-1.05%');
    });

    it('renders zero (and -0) without a sign', () => {
      expect(formatPercentChange(0)).toBe('0.00%');
      expect(formatPercentChange(-0)).toBe('0.00%');
    });

    it('drops to one decimal once magnitude reaches 100', () => {
      expect(formatPercentChange(123.45)).toBe('+123.5%');
      expect(formatPercentChange(-250.49)).toBe('-250.5%');
    });

    it('matches the sign rule across a representative numeric sweep', () => {
      const samples = [-999.9, -100, -42.5, -1, -0.01, 0, 0.01, 1, 42.5, 100, 999.9];
      for (const value of samples) {
        const formatted = formatPercentChange(value);
        if (value > 0) {
          expect(formatted.startsWith('+')).toBe(true);
        } else if (value < 0) {
          expect(formatted.startsWith('-')).toBe(true);
        } else {
          expect(formatted.startsWith('+')).toBe(false);
          expect(formatted.startsWith('-')).toBe(false);
        }
        expect(formatted.endsWith('%')).toBe(true);
      }
    });
  });

  // Feature: token-card-redesign, Property 3: Tone-to-color mapping
  describe('toneColor', () => {
    it('maps positive to the green token, negative to red, neutral to secondary text', () => {
      expect(toneColor('positive')).toBe(colors.semantic.receive);
      expect(toneColor('negative')).toBe(colors.semantic.error);
      expect(toneColor('neutral')).toBe(colors.text.secondary);
    });

    it('returns a defined color for every tone in the domain', () => {
      const tones: ChangeTone[] = ['positive', 'negative', 'neutral'];
      for (const tone of tones) {
        expect(typeof toneColor(tone)).toBe('string');
        expect(toneColor(tone).length).toBeGreaterThan(0);
      }
    });
  });
});
