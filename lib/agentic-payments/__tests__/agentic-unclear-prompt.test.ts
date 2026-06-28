import {
  getUnclearAgentPromptMessage,
  UNCLEAR_AGENT_PROMPT_MESSAGE,
} from '@/lib/agentic-payments/unclear-prompt';

describe('getUnclearAgentPromptMessage', () => {
  it('flags punctuation-only and keyboard-noise prompts', () => {
    expect(getUnclearAgentPromptMessage('???? !!!')).toBe(UNCLEAR_AGENT_PROMPT_MESSAGE);
    expect(getUnclearAgentPromptMessage('asdfasdfasdf')).toBe(UNCLEAR_AGENT_PROMPT_MESSAGE);
    expect(getUnclearAgentPromptMessage('xqzplmnr')).toBe(UNCLEAR_AGENT_PROMPT_MESSAGE);
  });

  it('allows normal short requests and non-English text to reach the agent', () => {
    expect(getUnclearAgentPromptMessage('balance')).toBeNull();
    expect(getUnclearAgentPromptMessage('send 5 USDC')).toBeNull();
    expect(getUnclearAgentPromptMessage('मेरा बैलेंस दिखाओ')).toBeNull();
  });
});
