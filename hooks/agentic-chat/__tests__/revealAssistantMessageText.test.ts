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
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reveals text in chunks and clears pending when finished', async () => {
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

    const revealPromise = revealAssistantMessageText(id, 'Hello');

    expect(useAgenticChatStore.getState().messages[0]).toMatchObject({
      text: '',
      pending: true,
    });

    jest.advanceTimersByTime(18);
    await Promise.resolve();

    expect(useAgenticChatStore.getState().messages[0].text.length).toBeGreaterThan(0);

    jest.runAllTimers();
    await revealPromise;

    expect(useAgenticChatStore.getState().messages[0]).toMatchObject({
      text: 'Hello',
      pending: false,
    });
  });

  it('finishes immediately when aborted', async () => {
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
    const revealPromise = revealAssistantMessageText(id, 'Long reply text', {
      signal: controller.signal,
    });

    controller.abort();
    jest.runAllTimers();
    await revealPromise;

    expect(useAgenticChatStore.getState().messages[0]).toMatchObject({
      text: 'Long reply text',
      pending: false,
    });
  });
});
