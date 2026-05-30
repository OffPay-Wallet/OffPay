import {
  PAYROLL_RECIPIENT_PROBE_CAP,
  probeRecipientRegistration,
} from '@/lib/payroll/payroll-recipient-registration';
import { fetchUmbraRegistrationStatusForAddresses } from '@/lib/umbra/umbra-execution';
import { createAbortError } from '@/lib/perf/abort';

jest.mock('@/lib/umbra/umbra-execution', () => ({
  __esModule: true,
  fetchUmbraRegistrationStatusForAddresses: jest.fn(),
}));

const mockLookup = fetchUmbraRegistrationStatusForAddresses as jest.Mock;

function statusWith(mixerRegistered: boolean) {
  return {
    vaultState: mixerRegistered ? 'exists' : 'non_existent',
    vaultRegistered: mixerRegistered,
    vaultCanShield: mixerRegistered,
    mixerRegistered,
  };
}

/** Builds the address->status map the batched lookup returns. */
function lookupResult(map: Record<string, boolean | null>) {
  const out: Record<string, unknown> = {};
  for (const [address, value] of Object.entries(map)) {
    out[address] = value == null ? null : statusWith(value);
  }
  return out;
}

describe('probeRecipientRegistration', () => {
  beforeEach(() => mockLookup.mockReset());

  it('queries recipients against the SENDER runtime, not their own', async () => {
    mockLookup.mockResolvedValue(lookupResult({ reg: true, unreg: false }));

    const result = await probeRecipientRegistration({
      recipients: ['reg', 'unreg', 'reg'],
      network: 'mainnet',
      signerWalletAddress: 'sender',
      walletId: 'wallet-1',
    });

    expect(result.registeredByAddress).toEqual({ reg: true, unreg: false });
    // Deduplicated, single batched lookup, signer is the active wallet.
    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(mockLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        signerWalletAddress: 'sender',
        walletId: 'wallet-1',
        lookupAddresses: ['reg', 'unreg'],
        network: 'mainnet',
      }),
    );
  });

  it('skips the sender / self addresses', async () => {
    mockLookup.mockResolvedValue(lookupResult({ other: true }));

    const result = await probeRecipientRegistration({
      recipients: ['self', 'other'],
      network: 'mainnet',
      signerWalletAddress: 'self',
      walletId: null,
      skip: new Set(['self']),
    });

    expect(result.registeredByAddress).toEqual({ other: true });
    expect(mockLookup).toHaveBeenCalledWith(
      expect.objectContaining({ lookupAddresses: ['other'] }),
    );
  });

  it('treats a missing/null status as not registered', async () => {
    mockLookup.mockResolvedValue(lookupResult({ x: null }));

    const result = await probeRecipientRegistration({
      recipients: ['x'],
      network: 'mainnet',
      signerWalletAddress: 'sender',
      walletId: null,
    });

    expect(result.registeredByAddress).toEqual({ x: false });
  });

  it('treats a batch lookup failure as unregistered without caching false negatives', async () => {
    const cache = new Map<string, boolean>();
    mockLookup.mockRejectedValue(new Error('rpc unavailable'));

    const result = await probeRecipientRegistration({
      recipients: ['a', 'b'],
      network: 'mainnet',
      signerWalletAddress: 'sender',
      walletId: null,
      cache,
    });

    expect(result.registeredByAddress).toEqual({ a: false, b: false });
    expect(cache.size).toBe(0);
  });

  it('rethrows abort failures', async () => {
    mockLookup.mockRejectedValue(createAbortError('cancelled'));

    await expect(
      probeRecipientRegistration({
        recipients: ['a'],
        network: 'mainnet',
        signerWalletAddress: 'sender',
        walletId: null,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('caps probing and defaults over-cap recipients to not registered', async () => {
    const recipients = Array.from({ length: PAYROLL_RECIPIENT_PROBE_CAP + 5 }, (_, i) => `addr-${i}`);
    mockLookup.mockImplementation(({ lookupAddresses }: { lookupAddresses: string[] }) =>
      Promise.resolve(lookupResult(Object.fromEntries(lookupAddresses.map((a) => [a, true])))),
    );

    const result = await probeRecipientRegistration({
      recipients,
      network: 'mainnet',
      signerWalletAddress: 'sender',
      walletId: null,
    });

    expect(result.probedCount).toBe(PAYROLL_RECIPIENT_PROBE_CAP);
    expect(result.unprobed).toHaveLength(5);
    expect(mockLookup.mock.calls[0][0].lookupAddresses).toHaveLength(PAYROLL_RECIPIENT_PROBE_CAP);
    expect(result.registeredByAddress['addr-200']).toBe(false);
  });

  it('serves cached results without re-probing', async () => {
    const cache = new Map<string, boolean>([['mainnet:cached', true]]);
    mockLookup.mockResolvedValue(lookupResult({ fresh: false }));

    const result = await probeRecipientRegistration({
      recipients: ['cached', 'fresh'],
      network: 'mainnet',
      signerWalletAddress: 'sender',
      walletId: null,
      cache,
    });

    expect(result.registeredByAddress.cached).toBe(true);
    expect(result.registeredByAddress.fresh).toBe(false);
    // Only 'fresh' hit the network.
    expect(mockLookup).toHaveBeenCalledWith(
      expect.objectContaining({ lookupAddresses: ['fresh'] }),
    );
    expect(cache.get('mainnet:fresh')).toBe(false);
  });

  it('does not call the network when every recipient is cached', async () => {
    const cache = new Map<string, boolean>([['mainnet:a', true]]);

    const result = await probeRecipientRegistration({
      recipients: ['a'],
      network: 'mainnet',
      signerWalletAddress: 'sender',
      walletId: null,
      cache,
    });

    expect(result.registeredByAddress).toEqual({ a: true });
    expect(mockLookup).not.toHaveBeenCalled();
  });
});
