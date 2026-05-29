import { getAgenticConversationScopeKey, useAgenticChatStore } from '@/store/agenticChatStore';

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
      archivedAt: null,
    });
    expect(state.activeConversationIdByScope[getAgenticConversationScopeKey(scope)]).toBe(
      conversationId,
    );
  });

  it('archives, restores, and deletes a chat with linked messages and actions', () => {
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

    useAgenticChatStore.getState().archiveConversation(conversationId);
    expect(useAgenticChatStore.getState().conversations[0]?.archivedAt).toEqual(expect.any(Number));
    expect(
      useAgenticChatStore.getState().activeConversationIdByScope[
        getAgenticConversationScopeKey(scope)
      ],
    ).toBeNull();

    useAgenticChatStore.getState().unarchiveConversation(conversationId);
    expect(useAgenticChatStore.getState().conversations[0]?.archivedAt).toBeNull();
    expect(
      useAgenticChatStore.getState().activeConversationIdByScope[
        getAgenticConversationScopeKey(scope)
      ],
    ).toBe(conversationId);

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
});
