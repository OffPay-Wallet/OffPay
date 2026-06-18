import { describe, expect, it } from '@jest/globals';

import { requiresAuthentication } from '../auth';

describe('requiresAuthentication', () => {
  it('keeps public wallet dashboard reads unsigned like balance and transactions', () => {
    expect(requiresAuthentication('GET', '/api/wallet/dashboard')).toBe(false);
    expect(requiresAuthentication('GET', '/api/wallet/balance')).toBe(false);
    expect(requiresAuthentication('GET', '/api/wallet/transactions')).toBe(false);
  });

  it('still protects private wallet-prefixed mutations by default', () => {
    expect(requiresAuthentication('POST', '/api/wallet/dashboard')).toBe(true);
  });
});
