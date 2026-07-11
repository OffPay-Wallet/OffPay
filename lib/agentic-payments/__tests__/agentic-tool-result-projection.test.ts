import { projectAgenticToolResultForModel } from '@/lib/agentic-payments/tool-result-projection';

describe('projectAgenticToolResultForModel', () => {
  it('removes serialized transaction payloads at every nesting level', () => {
    const projected = projectAgenticToolResultForModel({
      status: 'drafted',
      transactionBase64: 'local-only-open-position',
      nested: {
        unsignedTransaction: 'local-only-quote',
        messageBase64: 'local-only-message',
        signed_transactions: ['local-only-signed'],
        rows: [
          {
            rawTransaction: 'local-only-raw',
            transactionStatus: 'ready',
          },
        ],
      },
    });

    expect(projected).toEqual({
      status: 'drafted',
      nested: {
        rows: [{ transactionStatus: 'ready' }],
      },
    });
    expect(JSON.stringify(projected)).not.toContain('local-only');
  });

  it('preserves non-payload transaction summaries', () => {
    expect(
      projectAgenticToolResultForModel({
        transactionCount: 2,
        transactions: [{ status: 'confirmed', amount: '1' }],
      }),
    ).toEqual({
      transactionCount: 2,
      transactions: [{ status: 'confirmed', amount: '1' }],
    });
  });

  it('keeps Umbra insertion indices on-device at every nesting level', () => {
    const projected = projectAgenticToolResultForModel({
      status: 'drafted',
      utxoInsertionIndices: [41, 42],
      nextScanStartIndex: '43',
      nested: {
        pendingClaimUtxoInsertionIndices: [41, 42],
        claimedUtxoInsertionIndices: [40],
      },
    });

    expect(projected).toEqual({ status: 'drafted', nested: {} });
  });
});
