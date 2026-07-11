import {
  clearAgenticActionTransactionPayload,
  redactAgenticActionForPersistence,
} from '@/lib/agentic-payments/action-persistence';

import type { AgenticChatAction } from '@/store/agenticChatStore';

describe('agentic action transaction persistence', () => {
  it('strips nested RWA transactions and expires the persisted draft', () => {
    const action = {
      id: 'rwa-1',
      kind: 'rwa_trade',
      status: 'needs_confirmation',
      unsignedTransaction: 'main-transaction',
      quoteId: 'quote-secret',
      unsignedTransactions: [
        {
          id: 'delegate',
          label: 'Delegate',
          target: 'solana_devnet',
          unsignedTransaction: 'delegate-transaction',
          transactionFormat: 'solana_legacy_transaction_base64',
        },
      ],
    } as AgenticChatAction;

    const persisted = redactAgenticActionForPersistence(action);
    expect(persisted).toMatchObject({
      status: 'failed',
      unsignedTransaction: '',
      quoteId: '',
      unsignedTransactions: [{ unsignedTransaction: '' }],
    });
    expect(action).toMatchObject({
      status: 'needs_confirmation',
      unsignedTransaction: 'main-transaction',
    });
  });

  it('clears Flash bytes after a terminal in-memory state update', () => {
    const action = {
      id: 'flash-1',
      kind: 'flash_position',
      status: 'submitted',
      transactionBase64: 'serialized-flash-transaction',
    } as AgenticChatAction;

    expect(clearAgenticActionTransactionPayload(action)).toMatchObject({
      status: 'submitted',
      transactionBase64: '',
    });
  });

  it('expires and clears a persisted Flash funding draft', () => {
    const action = {
      id: 'flash-deposit-1',
      kind: 'flash_deposit',
      status: 'needs_confirmation',
      transactionBase64: 'serialized-flash-funding',
    } as AgenticChatAction;

    expect(redactAgenticActionForPersistence(action)).toMatchObject({
      status: 'failed',
      transactionBase64: '',
    });
  });

  it('expires Umbra claim drafts and removes exact insertion indices from storage', () => {
    const action = {
      id: 'umbra-claim-1',
      kind: 'umbra_claim',
      status: 'needs_confirmation',
      utxoInsertionIndices: [41, 42],
    } as AgenticChatAction;

    expect(redactAgenticActionForPersistence(action)).toMatchObject({
      status: 'failed',
      utxoInsertionIndices: [],
      errorMessage: expect.stringContaining('expired'),
    });
  });

  it.each([
    'swap_trigger',
    'swap_recurring',
    'swap_trigger_cancel',
    'swap_recurring_cancel',
    'umbra_vault',
    'umbra_claim',
  ] as const)(
    'expires a pending %s intent even though it contains no transaction bytes',
    (kind) => {
      const action = {
        id: `advanced-${kind}`,
        kind,
        status: 'needs_confirmation',
      } as AgenticChatAction;

      expect(redactAgenticActionForPersistence(action)).toMatchObject({
        status: 'failed',
        errorMessage: expect.stringContaining('expired'),
      });
    },
  );
});
