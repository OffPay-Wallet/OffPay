import { resolveAgenticBalanceToken } from '@/lib/agentic-payments/token-resolution';

import type { WalletBalanceResponse } from '@/types/offpay-api';

const devnetUsdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const devnetUmbraDusdcMint = '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7';

const baseBalance: WalletBalanceResponse = {
  address: 'wallet-address',
  network: 'devnet',
  solBalance: 1_000_000_000,
  fetchedAt: 1_713_996_000_000,
  tokens: [
    {
      mint: devnetUsdcMint,
      name: 'USD Coin',
      symbol: 'USDC',
      logo: null,
      balance: '20',
      decimals: 6,
      verified: true,
      spam: false,
    },
    {
      // Devnet Umbra test token whose `aliases` list contains "USDC".
      // Without exact-symbol-wins precedence the resolver would mark
      // `usdc` as ambiguous between this and the real USDC row.
      mint: devnetUmbraDusdcMint,
      name: 'Devnet USDC (Umbra test)',
      symbol: 'dUSDC',
      logo: null,
      balance: '499.970126',
      decimals: 6,
      verified: true,
      spam: false,
    },
  ],
};

describe('resolveAgenticBalanceToken', () => {
  it('prefers an exact symbol match over an aliased entry on a different mint', () => {
    const result = resolveAgenticBalanceToken({
      balance: baseBalance,
      network: 'devnet',
      tokenText: 'usdc',
    });

    expect(result).toEqual({
      ok: true,
      token: expect.objectContaining({
        mint: devnetUsdcMint,
        symbol: 'USDC',
      }),
    });
  });

  it('matches on alias when there is no exact symbol match', () => {
    const aliasOnlyBalance: WalletBalanceResponse = {
      ...baseBalance,
      tokens: [baseBalance.tokens[1]],
    };

    const result = resolveAgenticBalanceToken({
      balance: aliasOnlyBalance,
      network: 'devnet',
      tokenText: 'usdc',
    });

    expect(result).toEqual({
      ok: true,
      token: expect.objectContaining({
        mint: devnetUmbraDusdcMint,
        symbol: 'dUSDC',
      }),
    });
  });

  it('still reports ambiguity when two exact symbol matches collide', () => {
    const ambiguousBalance: WalletBalanceResponse = {
      ...baseBalance,
      tokens: [
        baseBalance.tokens[0],
        { ...baseBalance.tokens[0], mint: 'AnotherUsdcMintAddressxxxxxxxxxxxxxxxxxxxxxxxx' },
      ],
    };

    const result = resolveAgenticBalanceToken({
      balance: ambiguousBalance,
      network: 'devnet',
      tokenText: 'usdc',
    });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('multiple tokens matching'),
    });
  });

  it('matches on exact mint regardless of symbol or alias collisions', () => {
    const result = resolveAgenticBalanceToken({
      balance: baseBalance,
      network: 'devnet',
      tokenText: devnetUmbraDusdcMint,
    });

    expect(result).toEqual({
      ok: true,
      token: expect.objectContaining({
        mint: devnetUmbraDusdcMint,
        symbol: 'dUSDC',
      }),
    });
  });

  it('reports a not-found error when nothing matches', () => {
    const result = resolveAgenticBalanceToken({
      balance: baseBalance,
      network: 'devnet',
      tokenText: 'XYZ',
    });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('I could not find XYZ'),
    });
  });
});
