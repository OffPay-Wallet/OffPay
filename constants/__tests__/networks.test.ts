import {
  DEFAULT_NETWORK,
  isSolanaNetworkSelectable,
  resolveSelectableSolanaNetwork,
  toOffpayNetwork,
} from '@/constants/networks';

describe('network selection policy', () => {
  it('keeps the default network selectable', () => {
    expect(DEFAULT_NETWORK).toBe('devnet');
    expect(isSolanaNetworkSelectable(DEFAULT_NETWORK)).toBe(true);
  });

  it('falls back to Devnet for disabled or unknown networks', () => {
    expect(isSolanaNetworkSelectable('mainnet-beta')).toBe(false);
    expect(resolveSelectableSolanaNetwork('mainnet-beta')).toBe('devnet');
    expect(resolveSelectableSolanaNetwork('testnet')).toBe('devnet');
    expect(resolveSelectableSolanaNetwork(null)).toBe('devnet');
  });

  it('never maps disabled Mainnet into the active API network', () => {
    expect(toOffpayNetwork('mainnet-beta')).toBe('devnet');
    expect(toOffpayNetwork('devnet')).toBe('devnet');
  });
});
