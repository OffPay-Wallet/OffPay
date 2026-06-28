import { sanitizeAssistantText } from '@/lib/agentic-payments/assistant-text';

describe('sanitizeAssistantText', () => {
  it('drops chain-of-thought scratchpad before the visible answer', () => {
    // Mirrors the model output from the user-reported screenshot.
    const raw = [
      'The user is asking to list all the tokens they hold.',
      'I need to look at the `walletBalanceApiResponse.tokens` in the provided safe client context.',
      '',
      'You hold the following tokens:',
      '* dUSDT: Devnet USDT (Umbra test) | Balance: 1000',
      '* USDC: USD Coin | Balance: 20',
      '* dUSDC: Devnet USDC (Umbra test) | Balance: 499.970126',
    ].join('\n');

    const cleaned = sanitizeAssistantText(raw, false);

    expect(cleaned.startsWith('You hold the following tokens')).toBe(true);
    expect(cleaned).not.toContain('The user is asking');
    expect(cleaned).not.toContain('I need to look');
    expect(cleaned).not.toContain('walletBalanceApiResponse');
    expect(cleaned).not.toContain('safe client context');
  });

  it('strips fenced tool-call blocks and the surrounding plan narration', () => {
    const raw = [
      'Tool call:',
      '```',
      'draft_normal_send(amount="4", recipient="8WDiy...e2XMz", token="USDC")',
      '```',
      'I should call this for the user.',
    ].join('\n');

    const cleaned = sanitizeAssistantText(raw, true);

    // hasToolDraft=true with no real prose left → empty so only the
    // confirmation card renders.
    expect(cleaned).toBe('');
  });

  it('drops "I should …" / "Let me …" narration lines', () => {
    const raw = [
      'Let me look at the wallet balance.',
      'I should present this information clearly.',
      'You hold 20 USDC.',
    ].join('\n');

    const cleaned = sanitizeAssistantText(raw, false);

    expect(cleaned).toBe('You hold 20 USDC.');
  });

  it('drops "Wait, the instructions say …" leakage', () => {
    const raw = [
      'Wait, the instructions say to use the active wallet only when the user asks.',
      'The user said "to my own wallet". So I will use the active wallet address.',
      '',
      'Drafting the transfer now.',
    ].join('\n');

    const cleaned = sanitizeAssistantText(raw, true);

    // hasToolDraft=true plus only short prose remaining → empty bubble.
    expect(cleaned).toBe('');
  });

  it('preserves a clean concise answer untouched', () => {
    const raw = 'Tell me which token to send: USDC or USDT.';

    expect(sanitizeAssistantText(raw, false)).toBe(raw);
  });

  it('caps runaway output at the visible char limit', () => {
    const raw = `${'a'.repeat(2000)}`;

    const cleaned = sanitizeAssistantText(raw, false);

    expect(cleaned.length).toBeLessThanOrEqual(600);
    expect(cleaned.endsWith('…')).toBe(true);
  });

  it('returns an empty string when only short stub text remains alongside a draft', () => {
    const cleaned = sanitizeAssistantText('OK.', true);
    expect(cleaned).toBe('');
  });

  it('keeps the empty string for an empty input', () => {
    expect(sanitizeAssistantText('', false)).toBe('');
  });

  it('drops a numbered plan and keeps only the actual greeting', () => {
    // Mirrors the user-reported screenshot.
    const raw = [
      'This is a simple greeting.',
      '',
      '1. Greet the user.',
      '2. Briefly state my purpose (assisting with wallet tasks).Hi! How can I help you with your wallet today?',
    ].join('\n');

    const cleaned = sanitizeAssistantText(raw, false);

    expect(cleaned).toBe('Hi! How can I help you with your wallet today?');
    expect(cleaned).not.toContain('This is a simple greeting');
    expect(cleaned).not.toContain('Greet the user');
    expect(cleaned).not.toContain('Briefly state my purpose');
  });

  it('drops the meta commentary on a name input and keeps the greeting', () => {
    const raw = [
      '"yuga" is not a standard command or part of the system instructions. It might be a name or a typo.',
      '',
      '1. Acknowledge the greeting.',
      '2. Ask how I can help with their wallet (e.g., checking balances, sending tokens).Hi! How can I help you with your wallet today?',
    ].join('\n');

    const cleaned = sanitizeAssistantText(raw, false);

    expect(cleaned).toBe('Hi! How can I help you with your wallet today?');
    expect(cleaned).not.toContain('not a standard command');
    expect(cleaned).not.toContain('Acknowledge the greeting');
    expect(cleaned).not.toContain('Ask how I can help');
  });

  it('preserves a clean numbered list that is the legitimate answer', () => {
    // Numbered lines that do NOT match the scratchpad verb set should
    // pass through. Only "greet|acknowledge|ask|briefly|state|consider…"
    // starters are filtered.
    const raw = ['1. USDC — USD Coin · 20', '2. dUSDC — Devnet USDC (Umbra test) · 499.97'].join(
      '\n',
    );

    const cleaned = sanitizeAssistantText(raw, false);

    expect(cleaned).toContain('USDC — USD Coin · 20');
    expect(cleaned).toContain('dUSDC — Devnet USDC (Umbra test) · 499.97');
  });

  it('normalizes markdown bullet markers before display', () => {
    const raw = ['Here is your activity:', '* Sent 2 USDC', '* Received 1 SOL'].join('\n');

    const cleaned = sanitizeAssistantText(raw, false);

    expect(cleaned).toBe(
      ['Here is your activity:', '- Sent 2 USDC', '- Received 1 SOL'].join('\n'),
    );
  });

  it('splits dense recent activity summaries into one item per line', () => {
    const raw =
      'Here is a summary of your recent activity: Sent 22 USDC via Umbra private send Received 0.25 SOL Received 20 USDC Sent 1 USDC';

    const cleaned = sanitizeAssistantText(raw, false);

    expect(cleaned).toBe(
      [
        'Here is a summary of your recent activity:',
        '- Sent 22 USDC via Umbra private send',
        '- Received 0.25 SOL',
        '- Received 20 USDC',
        '- Sent 1 USDC',
      ].join('\n'),
    );
  });

  it('splits inline markdown bullets that arrive in one model paragraph', () => {
    const raw = 'Here is your activity: * Sent 2 USDC * Received 1 SOL * Sent 1 USDC';

    const cleaned = sanitizeAssistantText(raw, false);

    expect(cleaned).toBe(
      ['Here is your activity:', '- Sent 2 USDC', '- Received 1 SOL', '- Sent 1 USDC'].join('\n'),
    );
  });
});
