import { inferPayrollTokenIdentifier } from '@/lib/payroll/payroll-token-inference';
import { resolvePayrollTokenContextByIdentifier } from '@/lib/payroll/payroll-wallet-eligibility';

import type { WalletBalanceResponse } from '@/types/offpay-api';

const MAGICBLOCK_DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const UMBRA_DEVNET_DUSDC = '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7';

function token(mint: string, symbol: string): WalletBalanceResponse['tokens'][number] {
  return {
    mint,
    name: symbol,
    symbol,
    logo: null,
    balance: '100',
    decimals: 6,
    verified: true,
    spam: false,
  };
}

describe('payroll token inference', () => {
  it('infers a single token column from CSV text', async () => {
    await expect(
      inferPayrollTokenIdentifier({
        fileName: 'payroll.csv',
        mimeType: 'text/csv',
        text: `recipient,amount,token\n11111111111111111111111111111111,4,USDC`,
      }),
    ).resolves.toBe('USDC');
  });

  it('does not infer mixed-token files into a single-token payroll', async () => {
    await expect(
      inferPayrollTokenIdentifier({
        fileName: 'payroll.csv',
        mimeType: 'text/csv',
        text: [
          'recipient,amount,token',
          '11111111111111111111111111111111,4,USDC',
          'So11111111111111111111111111111111111111112,4,USDT',
        ].join('\n'),
      }),
    ).resolves.toBeNull();
  });

  it('prefers exact devnet USDC before Umbra dUSDC alias', () => {
    const balance: WalletBalanceResponse = {
      address: 'wallet',
      network: 'devnet',
      solBalance: 1_000_000_000,
      fetchedAt: 1,
      tokens: [token(UMBRA_DEVNET_DUSDC, 'dUSDC'), token(MAGICBLOCK_DEVNET_USDC, 'USDC')],
    };

    expect(resolvePayrollTokenContextByIdentifier(balance, 'USDC', 'devnet')?.mint).toBe(
      MAGICBLOCK_DEVNET_USDC,
    );
  });

  it('uses the Umbra devnet alias when that is the only matching wallet token', () => {
    const balance: WalletBalanceResponse = {
      address: 'wallet',
      network: 'devnet',
      solBalance: 1_000_000_000,
      fetchedAt: 1,
      tokens: [token(UMBRA_DEVNET_DUSDC, 'dUSDC')],
    };

    expect(resolvePayrollTokenContextByIdentifier(balance, 'USDC', 'devnet')?.mint).toBe(
      UMBRA_DEVNET_DUSDC,
    );
  });
});
