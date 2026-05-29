import { parseRecipientInput } from '@/lib/identity/recipient-parser';

const EXAMPLE_ADDRESS = 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw';

describe('parseRecipientInput', () => {
  it('returns invalid for empty or whitespace-only input', () => {
    expect(parseRecipientInput('').kind).toBe('invalid');
    expect(parseRecipientInput('   ').kind).toBe('invalid');
    expect(parseRecipientInput(null).kind).toBe('invalid');
    expect(parseRecipientInput(undefined).kind).toBe('invalid');
  });

  it('detects base58 Solana addresses', () => {
    const result = parseRecipientInput(EXAMPLE_ADDRESS);
    expect(result).toEqual({ kind: 'address', address: EXAMPLE_ADDRESS });
  });

  it('detects explicit .sol names', () => {
    expect(parseRecipientInput('vitalik.sol')).toEqual({
      kind: 'sns',
      domain: 'vitalik.sol',
    });
    expect(parseRecipientInput('Foo.SOL')).toEqual({
      kind: 'sns',
      domain: 'foo.sol',
    });
  });

  it('detects @-prefixed X handles', () => {
    expect(parseRecipientInput('@vitalik')).toEqual({
      kind: 'x',
      handle: 'vitalik',
    });
    expect(parseRecipientInput('@VitalikButerin')).toEqual({
      kind: 'x',
      handle: 'VitalikButerin',
    });
  });

  it('detects X handles entered as URLs', () => {
    expect(parseRecipientInput('https://x.com/elonmusk')).toEqual({
      kind: 'x',
      handle: 'elonmusk',
    });
    expect(parseRecipientInput('twitter.com/jack')).toEqual({
      kind: 'x',
      handle: 'jack',
    });
  });

  it('treats bare alphanumeric input as ambiguous', () => {
    const result = parseRecipientInput('vitalik');
    expect(result).toEqual({ kind: 'ambiguous', sns: 'vitalik.sol', x: 'vitalik' });
  });

  it('routes underscores to the X-only path since SNS rejects them', () => {
    // SNS allows alphanumeric + hyphens; X allows alphanumeric + underscore.
    // The presence of an underscore disqualifies the SNS interpretation.
    const result = parseRecipientInput('hello_world');
    expect(result).toEqual({ kind: 'x', handle: 'hello_world' });
  });

  it('returns invalid for inputs that look like nothing recognisable', () => {
    expect(parseRecipientInput('two words').kind).toBe('invalid');
    expect(parseRecipientInput('not-an-x-or-sns-name').kind).toBe('sns'); // hyphenated falls to SNS
    expect(parseRecipientInput('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').kind).toBe('sns');
  });

  it('rejects URL paths with extra segments', () => {
    expect(parseRecipientInput('https://x.com/jack/status/123').kind).toBe('invalid');
  });
});
