import { stagePayroll } from '@/lib/payroll/payroll-staging';

import type { PayrollTokenContext } from '@/lib/payroll/payroll-validation';

const ADDR_A = '8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz';
const ADDR_B = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SENDER = '5FHwkrdxntdK24hgQU8qgBjn35Y1zwhz1GZdTh7DTLBy';

const TOKEN: PayrollTokenContext = {
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  symbol: 'USDC',
  decimals: 6,
  balanceAtomic: null,
};

describe('stagePayroll', () => {
  it('stages a valid CSV into a ready run with normalized rows', async () => {
    const result = await stagePayroll({
      fileName: 'payroll.csv',
      text: `name,wallet,amount\nAlice,${ADDR_A},100\nBob,${ADDR_B},50`,
      walletAddress: SENDER,
      network: 'mainnet',
      token: TOKEN,
      routePolicy: 'private_auto',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.status).toBe('ready');
    expect(result.run.rowIds).toHaveLength(2);
    expect(result.summary.validCount).toBe(2);
    expect(result.summary.totalAtomic).toBe('150000000');
  });

  it('rejects unsupported file types with guidance', async () => {
    const result = await stagePayroll({
      fileName: 'payroll.xlsx',
      text: 'binary',
      walletAddress: SENDER,
      network: 'mainnet',
      token: TOKEN,
      routePolicy: 'private_auto',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/CSV or TSV/);
  });

  it('asks for manual mapping when recipient/amount columns are absent', async () => {
    const result = await stagePayroll({
      fileName: 'payroll.csv',
      text: 'col_a,col_b\nfoo,bar',
      walletAddress: SENDER,
      network: 'mainnet',
      token: TOKEN,
      routePolicy: 'private_auto',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/map them manually/i);
  });

  it('honors a manual mapping override', async () => {
    const result = await stagePayroll({
      fileName: 'payroll.csv',
      text: `who,pay\n${ADDR_A},100`,
      walletAddress: SENDER,
      network: 'mainnet',
      token: TOKEN,
      routePolicy: 'umbra_only',
      mappingOverride: { recipient: 'who', amount: 'pay', token: null, label: null },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.validCount).toBe(1);
    expect(result.run.routePolicy).toBe('umbra_only');
  });
});
