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

  it('can commit text immediately and clear pending', async () => {
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

    await revealAssistantMessageText(id, 'Hello', { typing: false });

    expect(useAgenticChatStore.getState().messages[0]).toMatchObject({
      text: 'Hello',
      pending: false,
    });
  });

  it('streams longer replies while pending before settling the full text', async () => {
    jest.useFakeTimers();
    const id = 'assistant-stream';
    useAgenticChatStore.setState({
      messages: [
        {
          id,
          role: 'assistant',
          text: '',
          createdAt: 1,
          conversationId: 'c1',
          pending: true,
          processingLabel: 'Writing response',
          walletAddress: null,
          network: null,
        },
      ],
    });

    const fullText = 'Here is your wallet activity in a readable summary.';
    const reveal = revealAssistantMessageText(id, fullText, {
      typing: { intervalMs: 10, minChunkCharacters: 8 },
    });

    await Promise.resolve();
    expect(useAgenticChatStore.getState().messages[0]).toMatchObject({
      text: expect.stringMatching(/^Here is/),
      pending: true,
      processingLabel: null,
    });
    expect(useAgenticChatStore.getState().messages[0].text).not.toBe(fullText);

    await jest.runAllTimersAsync();
    await reveal;

    expect(useAgenticChatStore.getState().messages[0]).toMatchObject({
      text: fullText,
      pending: false,
    });
    jest.useRealTimers();
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
