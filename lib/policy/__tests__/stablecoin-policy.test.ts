import {
  getStablecoinPolicyEntries,
  isSupportedStablecoinToken,
} from '@/lib/policy/stablecoin-policy';

describe('stablecoin policy', () => {
  it('supports USDC and USDT symbols on every active network without hardcoding test mints', () => {
    expect(isSupportedStablecoinToken({ network: 'mainnet', token: 'USDC' })).toBe(true);
    expect(isSupportedStablecoinToken({ network: 'mainnet', token: 'USDT' })).toBe(true);
    expect(isSupportedStablecoinToken({ network: 'devnet', token: 'USDC' })).toBe(true);
    expect(isSupportedStablecoinToken({ network: 'devnet', token: 'USDT' })).toBe(true);
  });

  it('does not treat an arbitrary mint as supported just because the symbol says USDC', () => {
    expect(
      isSupportedStablecoinToken({
        network: 'devnet',
        token: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
        symbol: 'USDC',
      }),
    ).toBe(false);
    expect(
      isSupportedStablecoinToken({
        network: 'devnet',
        token: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        symbol: 'USDC',
      }),
    ).toBe(true);
  });

  it('keeps private/offline devnet payments on the canonical MagicBlock USDC mint', () => {
    expect(getStablecoinPolicyEntries('devnet')).toEqual([
      {
        symbol: 'USDC',
        mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        decimals: 6,
        enabled: true,
        name: 'USD Coin',
      },
      {
        symbol: 'USDT',
        mint: '',
        decimals: 6,
        enabled: false,
        name: 'Tether USD',
      },
    ]);
  });
});
