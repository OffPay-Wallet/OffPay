import {
  detectDelimiter,
  looksBinary,
  resolvePayrollFormat,
  stripBom,
} from '@/lib/payroll/parsing/payroll-formats';
import { inferPayrollColumns } from '@/lib/payroll/parsing/payroll-column-mapping';
import { parsePayrollTable } from '@/lib/payroll/parsing/payroll-table-parser';

describe('payroll format resolution', () => {
  it('accepts supported text formats by extension', () => {
    expect(resolvePayrollFormat('payroll.csv')).toEqual({ ok: true, format: 'csv' });
    expect(resolvePayrollFormat('payroll.tsv')).toEqual({ ok: true, format: 'tsv' });
    expect(resolvePayrollFormat('payroll.txt')).toEqual({ ok: true, format: 'txt' });
    expect(resolvePayrollFormat('payroll.json')).toEqual({ ok: true, format: 'json' });
  });

  it('rejects spreadsheets and documents with export guidance', () => {
    const xlsx = resolvePayrollFormat('payroll.xlsx');
    expect(xlsx.ok).toBe(false);
    expect(xlsx.message).toMatch(/CSV or TSV/);
    expect(resolvePayrollFormat('payroll.pdf').ok).toBe(false);
    expect(resolvePayrollFormat('payroll.docx').ok).toBe(false);
  });

  it('falls back to MIME hints when the extension is missing', () => {
    expect(resolvePayrollFormat('payroll', 'application/json')).toEqual({
      ok: true,
      format: 'json',
    });
  });

  it('detects delimiters and binary content', () => {
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(looksBinary('\u0000\u0001\u0002binary')).toBe(true);
    expect(looksBinary('plain,text,row')).toBe(false);
    expect(stripBom('\ufeffhello')).toBe('hello');
  });
});

describe('parsePayrollTable', () => {
  it('parses a CSV happy path', async () => {
    const result = await parsePayrollTable({
      text: 'name,wallet,amount\nAlice,addr1,100\nBob,addr2,200',
      format: 'csv',
    });
    expect(result.ok).toBe(true);
    expect(result.table?.headers).toEqual(['name', 'wallet', 'amount']);
    expect(result.table?.records).toHaveLength(2);
    expect(result.table?.records[0]).toMatchObject({
      name: 'Alice',
      wallet: 'addr1',
      amount: '100',
    });
  });

  it('parses TSV and pipe-delimited TXT', async () => {
    const tsv = await parsePayrollTable({
      text: 'name\twallet\tamount\nAlice\taddr1\t100',
      format: 'tsv',
    });
    expect(tsv.table?.records[0]).toMatchObject({ wallet: 'addr1' });

    const txt = await parsePayrollTable({
      text: 'name|wallet|amount\nAlice|addr1|100',
      format: 'txt',
    });
    expect(txt.table?.records[0]).toMatchObject({ amount: '100' });
  });

  it('parses headerless manual payroll rows', async () => {
    const result = await parsePayrollTable({
      text:
        '11111111111111111111111111111111 100\n' +
        'Bob So11111111111111111111111111111111111111112 50 USDC',
      format: 'txt',
    });

    expect(result.ok).toBe(true);
    expect(result.table?.headers).toEqual(['label', 'recipient', 'amount', 'token']);
    expect(result.table?.records).toHaveLength(2);
    expect(result.table?.records[0]).toMatchObject({
      recipient: '11111111111111111111111111111111',
      amount: '100',
    });
    expect(result.table?.records[1]).toMatchObject({
      label: 'Bob',
      recipient: 'So11111111111111111111111111111111111111112',
      amount: '50',
      token: 'USDC',
    });
  });

  it('disambiguates duplicate headers deterministically', async () => {
    const result = await parsePayrollTable({
      text: 'amount,amount,wallet\n1,2,addr1',
      format: 'csv',
    });
    expect(result.table?.headers).toEqual(['amount', 'amount_2', 'wallet']);
  });

  it('parses JSON arrays of row objects', async () => {
    const result = await parsePayrollTable({
      text: JSON.stringify([{ wallet: 'addr1', amount: 100 }]),
      format: 'json',
    });
    expect(result.ok).toBe(true);
    expect(result.table?.records[0]).toMatchObject({ wallet: 'addr1', amount: '100' });
  });

  it('rejects empty, invalid JSON, and binary content', async () => {
    expect((await parsePayrollTable({ text: '', format: 'csv' })).ok).toBe(false);
    expect((await parsePayrollTable({ text: '{bad json', format: 'json' })).ok).toBe(false);
    expect(
      (await parsePayrollTable({ text: '\u0000\u0000\u0000binary junk', format: 'csv' })).ok,
    ).toBe(false);
  });

  it('honors an abort signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      parsePayrollTable({ text: 'a,b\n1,2', format: 'csv', signal: controller.signal }),
    ).rejects.toThrow(/cancelled/i);
  });
});

describe('inferPayrollColumns', () => {
  it('maps recipient and amount with high confidence', () => {
    const inference = inferPayrollColumns({
      headers: ['employee', 'wallet', 'amount', 'token'],
      records: [],
    });
    expect(inference.mapping.recipient).toBe('wallet');
    expect(inference.mapping.amount).toBe('amount');
    expect(inference.mapping.token).toBe('token');
    expect(inference.mapping.label).toBe('employee');
    expect(inference.confidence).toBe(1);
    expect(inference.needsManualMapping).toBe(false);
  });

  it('flags manual mapping when recipient or amount is missing', () => {
    const inference = inferPayrollColumns({ headers: ['col_a', 'col_b'], records: [] });
    expect(inference.needsManualMapping).toBe(true);
    expect(inference.confidence).toBeLessThan(1);
  });
});
