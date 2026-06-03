import { getUmbraFriendlyError } from '@/lib/umbra/umbra-error-messages';

describe('umbra-error-messages', () => {
  it('maps ambiguous raw Solana custom 1 failures to SOL funding guidance', () => {
    const error = getUmbraFriendlyError(
      new Error(
        'Umbra withdraw transaction failed on-chain: {"InstructionError":[1,{"Custom":1}]}',
      ),
      'withdraw',
    );

    expect(error).toEqual({
      title: 'Add SOL or refresh balance',
      message: 'Need SOL for temporary accounts.',
    });
  });

  it('maps explicit insufficient token failures to shielded balance guidance', () => {
    const error = getUmbraFriendlyError(
      new Error('Umbra withdraw transaction failed on-chain: insufficient token balance'),
      'withdraw',
    );

    expect(error.title).toBe('Not enough shielded balance');
    expect(error.message).toBe('Refresh vault or withdraw less.');
  });

  it('maps setup rent errors to an SOL funding message', () => {
    const error = getUmbraFriendlyError(
      { InstructionError: [1, { InsufficientFundsForRent: { account_index: 0 } }] },
      'setup',
    );

    expect(error.title).toBe('Add SOL for fees');
    expect(error.message).toBe('Need more SOL for rent and network fees.');
  });

  it('maps incompatible Umbra fee vault layout failures to vault unavailable', () => {
    const error = getUmbraFriendlyError(
      new Error(
        'Transaction simulation failed: Error processing Instruction 1: custom program error: 0xbbb. AnchorError caused by account: fee_vault. Error Code: AccountDidNotDeserialize.',
      ),
      'shield',
    );

    expect(error).toEqual({
      title: 'Vault unavailable',
      message: 'Token/network vault is not enabled.',
    });
  });

  it('does not map relayer request body format errors to vault unavailable', () => {
    const error = getUmbraFriendlyError(
      new Error(
        'Failed to deserialize the JSON body into the target type: missing field `variant` at line 1 column 2625',
      ),
      'claim',
    );

    expect(error).toEqual({
      title: 'Claim failed',
      message: 'Claim request format mismatch. Update the API worker and retry.',
    });
  });

  it('does not misclassify non-fee Umbra hex errors as missing SOL', () => {
    const error = getUmbraFriendlyError(
      new Error(
        'Program failed to complete: custom program error: 0x183c, reclaimComputationRent: false',
      ),
      'shield',
    );

    expect(error.title).toBe('Shield failed');
    expect(error.message).toBe('Rejected on-chain. Refresh and retry.');
  });

  it('keeps unknown custom program failures generic and non-raw', () => {
    const error = getUmbraFriendlyError({ InstructionError: [1, { Custom: 9999 }] }, 'shield');

    expect(error).toEqual({
      title: 'Shield failed',
      message: 'Rejected on-chain. Refresh and retry.',
    });
  });

  it('maps missing anonymous usage account state to setup guidance', () => {
    const error = getUmbraFriendlyError(
      new Error(
        'Program Error: Instruction #2 Failed - custom program error: 18003 / Arcium encrypted user account is active for anonymous usage bit must be set',
      ),
      'shield',
    );

    expect(error).toEqual({
      title: 'Private P2P setup required',
      message: 'Complete Umbra private P2P setup, wait for confirmation, then retry.',
    });
  });
});
