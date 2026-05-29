import {
  getShieldedStablecoinValueLabel,
  getVaultTokenRowLabel,
} from '@/components/features/umbra-vault/umbra-vault-format';

import type { UmbraVaultBalance } from '@/components/features/umbra-vault/types';

describe('umbra-vault-format', () => {
  it('does not render missing shielded data as zero while loading or failed', () => {
    expect(getShieldedStablecoinValueLabel([], ['dUSDC', 'dUSDT'], { loadState: 'loading' })).toBe(
      'Checking',
    );
    expect(getVaultTokenRowLabel([], 'dUSDC', { loadState: 'loading' })).toBe('Checking...');

    expect(getShieldedStablecoinValueLabel([], ['dUSDC', 'dUSDT'], { loadState: 'error' })).toBe(
      '--',
    );
    expect(getVaultTokenRowLabel([], 'dUSDC', { loadState: 'error' })).toBe('Refresh failed');
  });

  it('keeps true empty shielded accounts distinct from unreadable accounts', () => {
    const balances: UmbraVaultBalance[] = [
      {
        mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
        symbol: 'dUSDC',
        name: 'Devnet USDC',
        decimals: 6,
        logoUri: null,
        state: 'shared',
        rawBalance: '0',
        displayBalance: '0',
      },
      {
        mint: 'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6',
        symbol: 'dUSDT',
        name: 'Devnet USDT',
        decimals: 6,
        logoUri: null,
        state: 'non_existent',
        rawBalance: null,
        displayBalance: null,
      },
    ];

    expect(getShieldedStablecoinValueLabel(balances, ['dUSDC', 'dUSDT'])).toBe('$0.00');
    expect(getVaultTokenRowLabel(balances, 'dUSDC')).toBe('0 dUSDC');
    expect(getVaultTokenRowLabel(balances, 'dUSDT')).toBe('0 dUSDT');
  });

  it('does not flatten unreadable shared balances to zero', () => {
    const balances: UmbraVaultBalance[] = [
      {
        mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
        symbol: 'dUSDC',
        name: 'Devnet USDC',
        decimals: 6,
        logoUri: null,
        state: 'shared_unreadable',
        rawBalance: null,
        displayBalance: null,
      },
    ];

    expect(getShieldedStablecoinValueLabel(balances, ['dUSDC'])).toBe('--');
    expect(getVaultTokenRowLabel(balances, 'dUSDC')).toBe('Unavailable');
  });

  it('marks unknown shielded account states as unavailable instead of zero', () => {
    const balances: UmbraVaultBalance[] = [
      {
        mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
        symbol: 'dUSDC',
        name: 'Devnet USDC',
        decimals: 6,
        logoUri: null,
        state: 'unknown',
        rawBalance: null,
        displayBalance: null,
      },
    ];

    expect(getShieldedStablecoinValueLabel(balances, ['dUSDC'])).toBe('--');
    expect(getVaultTokenRowLabel(balances, 'dUSDC')).toBe('Unavailable');
  });
});
