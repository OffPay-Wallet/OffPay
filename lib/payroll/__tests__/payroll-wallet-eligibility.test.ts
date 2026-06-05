import {
  buildPayrollTokenContexts,
  resolveKnownPayrollTokenContext,
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

function devnetBalanceWith(tokens: WalletBalanceResponse['tokens']): WalletBalanceResponse {
  return {
    address: 'wallet-1',
    network: 'devnet',
    solBalance: 1,
    tokens,
  } as WalletBalanceResponse;
}

function token(
  overrides: Partial<WalletBalanceResponse['tokens'][number]>,
): WalletBalanceResponse['tokens'][number] {
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
    expect(walletCanSignPayroll({ importMethod: 'generated' })).toBe(true);
    expect(walletCanSignPayroll({ importMethod: 'mnemonic-import' })).toBe(true);
    expect(walletCanSignPayroll({ importMethod: 'private-key-import' })).toBe(true);
  });

  it('allows Privy embedded wallets and blocks unknown wallets', () => {
    expect(walletCanSignPayroll({ importMethod: 'privy-embedded' })).toBe(true);
    expect(walletCanSignPayroll({ importMethod: null })).toBe(false);
    expect(walletCanSignPayroll({ importMethod: undefined })).toBe(false);
  });
});

describe('resolvePayrollTokenContext', () => {
  it('resolves mint/decimals and converts the UI balance to atomic', () => {
    const context = resolvePayrollTokenContext(balanceWith([token({})]), 'USDC');
    expect(context).toMatchObject({
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

  it('adds Umbra devnet token aliases for validation', () => {
    const [context] = buildPayrollTokenContexts(
      devnetBalanceWith([
        token({
          mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
          symbol: 'dUSDC',
        }),
      ]),
    );
    expect(context.aliases).toEqual(['USDC']);
  });

  it('resolves known stablecoins with zero balance when the wallet does not hold them', () => {
    expect(resolveKnownPayrollTokenContext('USDC', 'mainnet')).toMatchObject({
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      decimals: 6,
      balanceAtomic: '0',
    });
  });

  it('resolves explicit Umbra devnet token symbols with aliases and zero balance', () => {
    expect(resolveKnownPayrollTokenContext('dUSDC', 'devnet')).toMatchObject({
      mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
      symbol: 'dUSDC',
      aliases: ['USDC'],
      balanceAtomic: '0',
    });
  });
});
