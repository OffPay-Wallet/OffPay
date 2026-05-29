import { isSnsNameInput, normalizeSnsNameInput } from '@/lib/identity/sns';

describe('sns helpers', () => {
  it('normalizes SNS names with or without the .sol suffix', () => {
    expect(normalizeSnsNameInput('Example')).toBe('example.sol');
    expect(normalizeSnsNameInput('@example.sol')).toBe('example.sol');
    expect(isSnsNameInput('example.sol')).toBe(true);
  });

  it('does not treat wallet addresses, links, blanks, or spaced values as SNS names', () => {
    expect(normalizeSnsNameInput('Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw')).toBeNull();
    expect(normalizeSnsNameInput('solana:Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw')).toBeNull();
    expect(normalizeSnsNameInput('two words')).toBeNull();
    expect(normalizeSnsNameInput('')).toBeNull();
  });
});
