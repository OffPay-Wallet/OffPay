import { OFFPAY_AGENT_TURN_PROMPT } from '../prompts/agent-turn';

describe('agent turn prompt', () => {
  it('keeps RWA buy and sell phrasing routed to RWA tools', () => {
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('Natural commands like "buy me 5 Tesla"');
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('Treat company-name trade phrases');
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('Do not use prepare_swap_quote for RWA stocks.');
  });
});
