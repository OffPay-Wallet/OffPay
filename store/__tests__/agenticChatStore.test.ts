import { getAgenticConversationScopeKey, useAgenticChatStore } from '@/store/agenticChatStore';
import { usePayrollStore } from '@/store/payrollStore';

import type { PayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';
import type { PayrollRow, PayrollRun } from '@/lib/payroll/payroll-types';

function payrollSummary(): PayrollConfirmationSummary {
  return {
    walletAddress: 'wallet-1',
    network: 'devnet',
    tokenSymbol: 'USDC',
    tokenMint: 'mint-1',
    recipientCount: 1,
    totalAtomic: '1000000',
    totalDisplay: '1',
    totalLabel: '1 USDC',
    tokenBreakdown: [
      {
        tokenSymbol: 'USDC',
        tokenMint: 'mint-1',
        tokenDecimals: 6,
        recipientCount: 1,
        totalAtomic: '1000000',
        totalDisplay: '1',
      },
    ],
    isMixedTokenRun: false,
    routePolicy: 'private_auto',
    split: { umbra: 1, magicblock: 0, blocked: 0, claimRequired: 1 },
    invalidCount: 0,
    skippedCount: 0,
    claimRequiredCount: 1,
    requiresUmbraSetup: false,
    hasSufficientBalanceForRun: true,
    requiresTypedConfirmation: false,
    showLargeBatchWarning: false,
    unprobedRecipientCount: 0,
  };
}

function makePayrollRun(overrides: Partial<PayrollRun> = {}): PayrollRun {
  return {
    id: 'run-1',
    walletAddress: 'wallet-1',
    network: 'devnet',
    status: 'cancelled',
    routePolicy: 'private_auto',
    tokenMint: 'mint-1',
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    sourceName: 'payroll.csv',
    rowIds: ['row-1'],
    cursor: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makePayrollRow(overrides: Partial<PayrollRow> = {}): PayrollRow {
  return {
    id: 'row-1',
    sourceRow: 2,
    label: 'Alice',
    recipient: 'recipient-1',
    tokenMint: 'mint-1',
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    amountAtomic: '1000000',
    amountDisplay: '1',
    route: null,
    status: 'skipped',
    requiresRecipientClaim: false,
    validationError: null,
    signature: null,
    txId: null,
    initSignature: null,
    idempotencyKey: 'row-1-key',
    retryCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('agenticChatStore', () => {
  const scope = { walletAddress: 'wallet-1', network: 'devnet' as const };

  beforeEach(() => {
    useAgenticChatStore.getState().clearMessages();
    usePayrollStore.setState({ runs: {}, rowsByRun: {} });
  });

  afterEach(() => {
    useAgenticChatStore.getState().clearMessages();
    usePayrollStore.setState({ runs: {}, rowsByRun: {} });
  });

  it('creates active conversations scoped by wallet and network', () => {
    const conversationId = useAgenticChatStore.getState().createConversation(scope, 'Send 5 dUSDC');

    const state = useAgenticChatStore.getState();

    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0]).toMatchObject({
      id: conversationId,
      title: 'Send 5 dUSDC',
      walletAddress: scope.walletAddress,
      network: scope.network,
    });
    expect(state.activeConversationIdByScope[getAgenticConversationScopeKey(scope)]).toBe(
      conversationId,
    );
  });

  it('deletes a chat with linked messages and actions', () => {
    const conversationId = useAgenticChatStore
      .getState()
      .createConversation(scope, 'Agentic payment');

    useAgenticChatStore.getState().addMessage({
      id: 'message-1',
      role: 'user',
      text: 'send 1 dusdc',
      createdAt: 1,
      walletAddress: scope.walletAddress,
      network: scope.network,
      conversationId,
      actionId: 'action-1',
    });
    useAgenticChatStore.getState().upsertAction({
      id: 'action-1',
      kind: 'normal_send',
      status: 'needs_confirmation',
      walletAddress: scope.walletAddress,
      network: scope.network,
      recipient: 'recipient-1',
      amount: '1',
      rawAmount: '1000000',
      tokenMint: 'mint-1',
      tokenSymbol: 'dUSDC',
      tokenName: 'Devnet USDC',
      tokenLogo: null,
      tokenDecimals: 6,
      route: 'normal',
      conversationId,
      createdAt: 1,
      updatedAt: 1,
    });

    useAgenticChatStore.getState().deleteConversation(conversationId);
    expect(useAgenticChatStore.getState().conversations).toEqual([]);
    expect(useAgenticChatStore.getState().messages).toEqual([]);
    expect(useAgenticChatStore.getState().actions).toEqual([]);
    expect(
      useAgenticChatStore.getState().activeConversationIdByScope[
        getAgenticConversationScopeKey(scope)
      ],
    ).toBeNull();
  });

  it('deletes a chat with linked payroll action cards', () => {
    const conversationId = useAgenticChatStore.getState().createConversation(scope, 'Payroll');

    useAgenticChatStore.getState().addMessage({
      id: 'message-1',
      role: 'assistant',
      text: 'Payroll staged.',
      createdAt: 1,
      walletAddress: scope.walletAddress,
      network: scope.network,
      conversationId,
      actionId: 'payroll-action-1',
    });
    useAgenticChatStore.getState().upsertAction({
      id: 'payroll-action-1',
      kind: 'payroll',
      status: 'needs_confirmation',
      walletAddress: scope.walletAddress,
      network: scope.network,
      runId: 'run-1',
      summary: payrollSummary(),
      conversationId,
      createdAt: 1,
      updatedAt: 1,
    });

    useAgenticChatStore.getState().deleteConversation(conversationId);

    expect(useAgenticChatStore.getState().messages).toEqual([]);
    expect(useAgenticChatStore.getState().actions).toEqual([]);
  });

  it('deletes linked payroll run data when deleting a payroll chat', () => {
    const conversationId = useAgenticChatStore.getState().createConversation(scope, 'Payroll');
    usePayrollStore.getState().createRun(makePayrollRun(), [makePayrollRow()]);

    useAgenticChatStore.getState().addMessage({
      id: 'message-1',
      role: 'assistant',
      text: 'Payroll cancelled.',
      createdAt: 1,
      walletAddress: scope.walletAddress,
      network: scope.network,
      conversationId,
      actionId: 'payroll-action-1',
    });
    useAgenticChatStore.getState().upsertAction({
      id: 'payroll-action-1',
      kind: 'payroll',
      status: 'cancelled',
      walletAddress: scope.walletAddress,
      network: scope.network,
      runId: 'run-1',
      summary: payrollSummary(),
      conversationId,
      createdAt: 1,
      updatedAt: 1,
    });

    const deletedPayrollRunIds = useAgenticChatStore.getState().deleteConversation(conversationId);

    expect(deletedPayrollRunIds).toEqual(['run-1']);
    expect(useAgenticChatStore.getState().messages).toEqual([]);
    expect(useAgenticChatStore.getState().actions).toEqual([]);
    expect(usePayrollStore.getState().getRun('run-1')).toBeNull();
    expect(usePayrollStore.getState().getRows('run-1')).toEqual([]);
  });

  it('keeps an action card while a chat message still references it', () => {
    const conversationId = useAgenticChatStore.getState().createConversation(scope, 'Draft');
    useAgenticChatStore.getState().addMessage({
      id: 'message-1',
      role: 'assistant',
      text: 'Confirm this draft.',
      createdAt: 1,
      walletAddress: scope.walletAddress,
      network: scope.network,
      conversationId,
      actionId: 'referenced-action',
    });
    useAgenticChatStore.getState().upsertAction({
      id: 'referenced-action',
      kind: 'payroll',
      status: 'needs_confirmation',
      walletAddress: scope.walletAddress,
      network: scope.network,
      runId: 'run-1',
      summary: payrollSummary(),
      conversationId,
      createdAt: 1,
      updatedAt: 1,
    });

    for (let index = 0; index < 120; index += 1) {
      useAgenticChatStore.getState().upsertAction({
        id: `unreferenced-action-${index}`,
        kind: 'payroll',
        status: 'needs_confirmation',
        walletAddress: scope.walletAddress,
        network: scope.network,
        runId: `run-${index + 2}`,
        summary: payrollSummary(),
        conversationId,
        createdAt: index + 2,
        updatedAt: index + 2,
      });
    }

    expect(
      useAgenticChatStore.getState().actions.some((action) => action.id === 'referenced-action'),
    ).toBe(true);
  });
});
