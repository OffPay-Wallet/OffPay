import type { AgenticChatAction } from '@/store/agenticChatStore';

const EXPIRED_DRAFT_MESSAGE =
  'This transaction draft expired when the app closed. Ask Yuga to prepare a fresh one.';

function isFinalActionStatus(status: AgenticChatAction['status']): boolean {
  return (
    status === 'submitted' || status === 'queued' || status === 'cancelled' || status === 'failed'
  );
}

/** Removes unsigned transaction wire bytes while preserving display-only history. */
export function clearAgenticActionTransactionPayload(action: AgenticChatAction): AgenticChatAction {
  if (action.kind === 'swap') {
    return { ...action, unsignedTransaction: '', quoteId: '' };
  }
  if (action.kind === 'rwa_trade') {
    return {
      ...action,
      unsignedTransaction: '',
      quoteId: '',
      unsignedTransactions: action.unsignedTransactions?.map((transaction) => ({
        ...transaction,
        unsignedTransaction: '',
      })),
    };
  }
  if (action.kind === 'flash_position' || action.kind === 'flash_deposit') {
    return { ...action, transactionBase64: '' };
  }
  if (action.kind === 'umbra_claim') {
    return { ...action, utxoInsertionIndices: [] };
  }
  if (
    action.kind === 'swap_trigger' ||
    action.kind === 'swap_recurring' ||
    action.kind === 'swap_trigger_cancel' ||
    action.kind === 'swap_recurring_cancel' ||
    action.kind === 'umbra_vault'
  ) {
    // These intent-only drafts still depend on live prices, balances, and
    // provider state. Never resurrect a confirmation after process restart.
    return { ...action };
  }
  return action;
}

/**
 * Produces the only action shape allowed to reach persistent storage.
 * Transactional drafts cannot survive a process restart because blockhashes,
 * quotes, and serialized instructions may be stale; persist them as expired
 * display history and require a fresh provider quote.
 */
export function redactAgenticActionForPersistence(action: AgenticChatAction): AgenticChatAction {
  const cleared = clearAgenticActionTransactionPayload(action);
  if (cleared === action || isFinalActionStatus(cleared.status)) {
    return cleared;
  }

  return {
    ...cleared,
    status: 'failed',
    errorMessage: EXPIRED_DRAFT_MESSAGE,
  } as AgenticChatAction;
}

export const __agenticActionPersistenceInternal = { EXPIRED_DRAFT_MESSAGE };
