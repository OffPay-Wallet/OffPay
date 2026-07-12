import { formatRwaChangeLabel } from '@/components/features/rwa/rwa-trade-utils';

describe('RWA card formatting', () => {
  it('formats direction with a visible sign and compact precision', () => {
    expect(formatRwaChangeLabel(1.256)).toBe('+1.26%');
    expect(formatRwaChangeLabel(-0.2349)).toBe('-0.235%');
    expect(formatRwaChangeLabel(-0)).toBe('0%');
  });

  it('omits unavailable or invalid movement values', () => {
    expect(formatRwaChangeLabel(null)).toBeNull();
    expect(formatRwaChangeLabel(Number.NaN)).toBeNull();
    expect(formatRwaChangeLabel(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
