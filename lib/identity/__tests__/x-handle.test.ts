import { isXHandleInput, normalizeXHandle } from '@/lib/identity/x-handle';

describe('normalizeXHandle', () => {
  it('strips a leading @', () => {
    expect(normalizeXHandle('@vitalik')).toBe('vitalik');
    expect(normalizeXHandle('@@vitalik')).toBe('vitalik');
  });

  it('returns the bare handle as-is', () => {
    expect(normalizeXHandle('vitalik')).toBe('vitalik');
    expect(normalizeXHandle('VitalikButerin')).toBe('VitalikButerin');
  });

  it('extracts the handle from x.com / twitter.com URLs', () => {
    expect(normalizeXHandle('https://x.com/elonmusk')).toBe('elonmusk');
    expect(normalizeXHandle('http://www.twitter.com/jack')).toBe('jack');
    expect(normalizeXHandle('x.com/jack')).toBe('jack');
    expect(normalizeXHandle('twitter.com/@jack')).toBe('jack');
  });

  it('rejects names longer than 15 characters', () => {
    expect(normalizeXHandle('aaaaaaaaaaaaaaaa')).toBeNull();
  });

  it('rejects URL paths with extra segments', () => {
    expect(normalizeXHandle('x.com/jack/status/123')).toBeNull();
  });

  it('rejects wallet-address-like input', () => {
    expect(normalizeXHandle('Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw')).toBeNull();
  });

  it('rejects inputs with whitespace, emoji, or punctuation other than _', () => {
    expect(normalizeXHandle('hello world')).toBeNull();
    expect(normalizeXHandle('hello-world')).toBeNull();
    expect(normalizeXHandle('hello.world')).toBeNull();
  });

  it('accepts underscore handles since X allows them', () => {
    expect(normalizeXHandle('@hello_world')).toBe('hello_world');
  });

  it('normalises empty/whitespace input to null', () => {
    expect(normalizeXHandle('')).toBeNull();
    expect(normalizeXHandle('   ')).toBeNull();
    expect(normalizeXHandle(null)).toBeNull();
    expect(normalizeXHandle(undefined)).toBeNull();
  });
});

describe('isXHandleInput', () => {
  it('mirrors normalizeXHandle', () => {
    expect(isXHandleInput('@jack')).toBe(true);
    expect(isXHandleInput('jack')).toBe(true);
    expect(isXHandleInput('hello world')).toBe(false);
  });
});
