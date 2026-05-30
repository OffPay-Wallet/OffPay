import {
  resolvePayrollTokenContext,
  walletCanSignPayroll,
} from '@/lib/payroll/payroll-wallet-eligibility';

import type { WalletBalanceResponse } from '@/types/offpay-api';

function balanceWith(tokens: WalletBalanceResponse['tokens']): WalletBalanceResponse {
  return {
    address: 'wallet-1',
    network: 'mainnet',
    solBalance: 1,
    tokens,
  } as WalletBalanceResponse;
}

function token(overrides: Partial<WalletBalanceResponse['tokens'][number]>): WalletBalanceResponse['tokens'][number] {
  return {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    name: 'USD Coin',
    symbol: 'USDC',
    logo: null,
    balance: '100.5',
    decimals: 6,
    verified: true,
    spam: false,
    ...overrides,
  } as WalletBalanceResponse['tokens'][number];
}

describe('walletCanSignPayroll', () => {
  it('allows local signing wallets', () => {
    expect(walletCanSignPayroll('generated')).toBe(true);
    expect(walletCanSignPayroll('mnemonic-import')).toBe(true);
    expect(walletCanSignPayroll('private-key-import')).toBe(true);
  });

  it('blocks Privy embedded/address-only and unknown wallets', () => {
    expect(walletCanSignPayroll('privy-embedded')).toBe(false);
    expect(walletCanSignPayroll(null)).toBe(false);
    expect(walletCanSignPayroll(undefined)).toBe(false);
  });
});

describe('resolvePayrollTokenContext', () => {
  it('resolves mint/decimals and converts the UI balance to atomic', () => {
    const context = resolvePayrollTokenContext(balanceWith([token({})]), 'USDC');
    expect(context).toEqual({
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      decimals: 6,
      balanceAtomic: '100500000',
    });
  });

  it('matches case-insensitively and skips spam tokens', () => {
    const context = resolvePayrollTokenContext(
      balanceWith([token({ symbol: 'USDC', spam: true }), token({ symbol: 'usdc', balance: '5' })]),
      'USDC',
    );
    expect(context?.balanceAtomic).toBe('5000000');
  });

  it('returns null when the token is not held', () => {
    expect(resolvePayrollTokenContext(balanceWith([token({ symbol: 'USDT' })]), 'USDC')).toBeNull();
    expect(resolvePayrollTokenContext(null, 'USDC')).toBeNull();
  });
});
