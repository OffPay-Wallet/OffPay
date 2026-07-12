import { getRwaErrorMessage } from '@/components/features/rwa/rwa-trade-utils';

describe('getRwaErrorMessage', () => {
  it('preserves the actionable program log returned by transaction simulation', () => {
    expect(
      getRwaErrorMessage(
        new Error(
          'Transaction simulation failed: Program log: Error: insufficient funds for transfer',
        ),
      ),
    ).toBe('RWA settlement failed: Program log: Error: insufficient funds for transfer');
  });

  it('does not blame token funding when simulation has no detailed log', () => {
    expect(getRwaErrorMessage(new Error('Transaction simulation failed.'))).toBe(
      'RWA settlement simulation failed. Request a fresh quote and try again.',
    );
  });

  it('passes through non-simulation errors', () => {
    expect(getRwaErrorMessage(new Error('MagicBlock is still restoring the RWA intent.'))).toBe(
      'MagicBlock is still restoring the RWA intent.',
    );
  });
});
