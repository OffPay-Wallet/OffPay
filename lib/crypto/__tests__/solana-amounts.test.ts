import {
  formatLamportsAsExactSol,
  formatLamportsAsExactSolLabel,
  parseLamports,
} from '@/lib/crypto/solana-amounts';

describe('solana-amounts', () => {
  it('formats lamports without floating point rounding', () => {
    expect(formatLamportsAsExactSol(12_000_000)).toBe('0.012');
    expect(formatLamportsAsExactSol('6663343')).toBe('0.006663343');
    expect(formatLamportsAsExactSol(1_000_000_000n)).toBe('1');
    expect(formatLamportsAsExactSolLabel('5000')).toBe('0.000005 SOL');
  });

  it('parses finite integer lamports only', () => {
    expect(parseLamports('1000')).toBe(1000n);
    expect(parseLamports(1000.9)).toBe(1000n);
    expect(parseLamports('1.1')).toBeNull();
    expect(parseLamports(Number.NaN)).toBeNull();
  });
});
