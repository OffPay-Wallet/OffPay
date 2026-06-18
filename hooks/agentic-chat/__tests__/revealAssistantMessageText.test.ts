import { revealAssistantMessageText } from '@/hooks/agentic-chat/revealAssistantMessageText';
import { useAgenticChatStore } from '@/store/agenticChatStore';

describe('revealAssistantMessageText', () => {
  beforeEach(() => {
    useAgenticChatStore.setState({
      messages: [],
      actions: [],
      conversations: [],
      activeConversationIdByScope: {},
    });
  });

  it('commits text and clears pending in one update', async () => {
    const id = 'assistant-1';
    useAgenticChatStore.setState({
      messages: [
        {
          id,
          role: 'assistant',
          text: '',
          createdAt: 1,
          conversationId: 'c1',
          pending: true,
          walletAddress: null,
          network: null,
        },
      ],
    });

    await revealAssistantMessageText(id, 'Hello');

    expect(useAgenticChatStore.getState().messages[0]).toMatchObject({
      text: 'Hello',
      pending: false,
    });
  });

  it('commits full text even when the provided signal is aborted', async () => {
    const id = 'assistant-2';
    useAgenticChatStore.setState({
      messages: [
        {
          id,
          role: 'assistant',
          text: '',
          createdAt: 1,
          conversationId: 'c1',
          pending: true,
          walletAddress: null,
          network: null,
        },
      ],
    });

    const controller = new AbortController();
    controller.abort();
    await revealAssistantMessageText(id, 'Long reply text', {
      signal: controller.signal,
    });

    expect(useAgenticChatStore.getState().messages[0]).toMatchObject({
      text: 'Long reply text',
      pending: false,
    });
  });
});
