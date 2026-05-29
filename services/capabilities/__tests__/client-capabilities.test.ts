import { getClientCapabilities } from '@/services/capabilities';

describe('client capabilities', () => {
  it('advertises MagicBlock/offline stablecoins separately from Umbra devnet mixer tokens', () => {
    const stablecoins = getClientCapabilities('devnet').capabilities.offline?.supportedStablecoins;

    expect(stablecoins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: 'USDC',
          mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          enabled: true,
        }),
      ]),
    );
    expect(stablecoins).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7',
        }),
      ]),
    );
  });
});
