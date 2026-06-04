import { validatePayrollRows } from '@/lib/payroll/payroll-validation';

import type { PayrollColumnMapping } from '@/lib/payroll/parsing/payroll-column-mapping';
import type { PayrollTokenContext } from '@/lib/payroll/payroll-validation';
import type { PayrollTable } from '@/lib/payroll/parsing/payroll-table-parser';

// Two structurally valid devnet/base58 addresses (not real funds).
const ADDR_A = '8WDiYT4k6KXwPAeQagTrbaZLLzB7WLntYaj18Ne2XMz';
const ADDR_B = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SENDER = '5FHwkrdxntdK24hgQU8qgBjn35Y1zwhz1GZdTh7DTLBy';

const MAPPING: PayrollColumnMapping = {
  recipient: 'wallet',
  amount: 'amount',
  token: null,
  label: 'name',
};

const TOKEN: PayrollTokenContext = {
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  symbol: 'USDC',
  decimals: 6,
  balanceAtomic: null,
};

function tableFrom(records: Record<string, string>[]): PayrollTable {
  return { headers: ['name', 'wallet', 'amount'], records };
}

describe('validatePayrollRows', () => {
  it('normalizes valid rows to atomic amounts and computes the total', async () => {
    const result = await validatePayrollRows({
      runId: 'run-1',
      table: tableFrom([
        { name: 'Alice', wallet: ADDR_A, amount: '100' },
        { name: 'Bob', wallet: ADDR_B, amount: '50.5' },
      ]),
      mapping: MAPPING,
      token: TOKEN,
      senderAddress: SENDER,
    });

    expect(result.validCount).toBe(2);
    expect(result.invalidCount).toBe(0);
    expect(result.totalAtomic).toBe('150500000');
    expect(result.rows[0]).toMatchObject({ status: 'ready', amountAtomic: '100000000' });
  });

  it('flags invalid recipients, zero amounts, and self-payment', async () => {
    const result = await validatePayrollRows({
      runId: 'run-2',
      table: tableFrom([
        { name: 'BadAddr', wallet: 'not-an-address', amount: '10' },
        { name: 'Zero', wallet: ADDR_A, amount: '0' },
        { name: 'Self', wallet: SENDER, amount: '10' },
      ]),
      mapping: MAPPING,
      token: TOKEN,
      senderAddress: SENDER,
    });

    expect(result.validCount).toBe(0);
    expect(result.invalidCount).toBe(3);
    expect(result.rows[0].validationError).toMatch(/valid Solana/);
    expect(result.rows[1].validationError).toMatch(/greater than zero/);
    expect(result.rows[2].validationError).toMatch(/Self-payment/);
  });

  it('detects duplicate recipients after the first occurrence', async () => {
    const result = await validatePayrollRows({
      runId: 'run-3',
      table: tableFrom([
        { name: 'First', wallet: ADDR_A, amount: '10' },
        { name: 'Dup', wallet: ADDR_A, amount: '20' },
      ]),
      mapping: MAPPING,
      token: TOKEN,
      senderAddress: SENDER,
    });

    expect(result.validCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.rows[1].validationError).toMatch(/Duplicate/);
  });

  it('reports when the valid total exceeds the available balance', async () => {
    const result = await validatePayrollRows({
      runId: 'run-4',
      table: tableFrom([{ name: 'Alice', wallet: ADDR_A, amount: '100' }]),
      mapping: MAPPING,
      token: { ...TOKEN, balanceAtomic: '50000000' },
      senderAddress: SENDER,
    });

    expect(result.exceedsBalance).toBe(true);
  });

  it('assigns a stable idempotency key per recipient+amount+mint', async () => {
    const result = await validatePayrollRows({
      runId: 'run-5',
      table: tableFrom([{ name: 'Alice', wallet: ADDR_A, amount: '100' }]),
      mapping: MAPPING,
      token: TOKEN,
      senderAddress: SENDER,
    });

    expect(result.rows[0].idempotencyKey).toBe(`run-5:${ADDR_A}:${TOKEN.mint}:100000000`);
  });

  describe('token column validation', () => {
    const tableWithToken = (records: Record<string, string>[]) => ({
      headers: ['name', 'wallet', 'amount', 'token'],
      records,
    });
    const mappingWithToken = {
      recipient: 'wallet',
      amount: 'amount',
      token: 'token',
      label: 'name',
    };

    it('blocks a row whose token cell differs from the run token', async () => {
      const result = await validatePayrollRows({
        runId: 'run-tok',
        table: tableWithToken([{ name: 'Alice', wallet: ADDR_A, amount: '10', token: 'USDT' }]),
        mapping: mappingWithToken,
        token: TOKEN, // USDC
        senderAddress: SENDER,
      });
      expect(result.validCount).toBe(0);
      expect(result.rows[0].validationError).toMatch(/does not match the payroll token USDC/);
    });

    it('accepts a row whose token cell matches by symbol or mint, or is empty', async () => {
      const result = await validatePayrollRows({
        runId: 'run-tok2',
        table: tableWithToken([
          { name: 'BySymbol', wallet: ADDR_A, amount: '10', token: 'USDC' },
          { name: 'ByMint', wallet: ADDR_B, amount: '10', token: TOKEN.mint },
        ]),
        mapping: mappingWithToken,
        token: TOKEN,
        senderAddress: SENDER,
      });
      expect(result.validCount).toBe(2);
    });

    it('accepts a row whose token cell matches a run token alias', async () => {
      const result = await validatePayrollRows({
        runId: 'run-tok3',
        table: tableWithToken([{ name: 'ByAlias', wallet: ADDR_A, amount: '10', token: 'USDC' }]),
        mapping: mappingWithToken,
        token: { ...TOKEN, symbol: 'dUSDC', aliases: ['USDC'] },
        senderAddress: SENDER,
      });
      expect(result.validCount).toBe(1);
    });
  });

  describe('amount precision', () => {
    it('rejects an amount with more decimals than the token supports', async () => {
      const result = await validatePayrollRows({
        runId: 'run-prec',
        table: tableFrom([{ name: 'Alice', wallet: ADDR_A, amount: '1.1234567' }]),
        mapping: MAPPING,
        token: TOKEN, // 6 decimals
        senderAddress: SENDER,
      });
      expect(result.validCount).toBe(0);
      expect(result.rows[0].validationError).toMatch(/more than 6 decimal places/);
    });

    it('accepts an amount at exactly the token decimal limit', async () => {
      const result = await validatePayrollRows({
        runId: 'run-prec2',
        table: tableFrom([{ name: 'Alice', wallet: ADDR_A, amount: '1.123456' }]),
        mapping: MAPPING,
        token: TOKEN,
        senderAddress: SENDER,
      });
      expect(result.validCount).toBe(1);
      expect(result.rows[0].amountAtomic).toBe('1123456');
    });
  });
});
