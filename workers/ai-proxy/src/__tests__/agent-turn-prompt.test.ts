import { OFFPAY_AGENT_TURN_PROMPT } from '../prompts/agent-turn';

describe('agent turn prompt', () => {
  it('requires a local draft before promising confirmation UI', () => {
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('Confirmation-card invariant');
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('matching local draft tool returned a draft');
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('after a read or lookup tool returns');
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('Never repeat an identical tool call');
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('Use recipient "self" only');
  });

  it('keeps RWA buy and sell phrasing routed to RWA tools', () => {
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('Natural commands like "buy me 5 Tesla"');
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('Treat company-name trade phrases');
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('Do not use prepare_swap_quote for RWA stocks.');
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('pass asset and do not request the full catalog');
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('interpret it as RWAUSDC');
    expect(OFFPAY_AGENT_TURN_PROMPT).toContain('For follow-up replies after you asked for a missing RWA amount');
  });
});
