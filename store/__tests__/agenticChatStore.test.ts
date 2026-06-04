import { getAgenticConversationScopeKey, useAgenticChatStore } from '@/store/agenticChatStore';

import type { PayrollConfirmationSummary } from '@/lib/payroll/payroll-confirmation';

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

describe('agenticChatStore', () => {
  const scope = { walletAddress: 'wallet-1', network: 'devnet' as const };

  beforeEach(() => {
    useAgenticChatStore.getState().clearMessages();
  });

  afterEach(() => {
    useAgenticChatStore.getState().clearMessages();
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
