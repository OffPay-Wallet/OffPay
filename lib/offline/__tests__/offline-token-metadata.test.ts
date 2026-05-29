import {
  getCachedOfflineTokenMetadataEntries,
  getOfflineTokenDecimals,
  getOfflineTokenMetadata,
  observeOfflineSupportedStablecoins,
  observeOfflineTokenMetadataFromSwapTokens,
  observeOfflineTokenMetadataFromWalletBalance,
  resetOfflineTokenMetadataCache,
} from '@/lib/offline/offline-token-metadata';

import type { WalletBalanceResponse } from '@/types/offpay-api';

const BONK_MAINNET_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6C8d9h7T9JbV7cPr';

describe('offline-token-metadata', () => {
  beforeEach(() => {
    resetOfflineTokenMetadataCache();
  });

  it('resolves built-in SOL and network-specific stablecoin metadata', async () => {
    await expect(getOfflineTokenMetadata('mainnet', 'SOL')).resolves.toMatchObject({
      symbol: 'SOL',
      decimals: 9,
    });
    await expect(getOfflineTokenMetadata('devnet', 'USDC')).resolves.toMatchObject({
      symbol: 'USDC',
      decimals: 6,
      mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    });
    await expect(getOfflineTokenMetadata('mainnet', 'USDT')).resolves.toMatchObject({
      symbol: 'USDT',
      decimals: 6,
      mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    });
    await expect(
      getOfflineTokenMetadata('devnet', '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7'),
    ).resolves.toMatchObject({
      symbol: 'dUSDC',
      decimals: 6,
      logo: expect.stringContaining('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    });
    expect(getCachedOfflineTokenMetadataEntries('devnet')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mint: 'DXQwBNGgyQ2BzGWxEriJPVmXYFQBsQbXvfvfSNTaJkL6',
          symbol: 'dUSDT',
          logo: expect.stringContaining('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
        }),
      ]),
    );
  });

  it('stores observed wallet-balance tokens by mint and keeps network isolation', async () => {
    const balance: WalletBalanceResponse = {
      address: 'Arbj11u1RHjfUwnBsg2zTWFP82EdCAxirxGvLrvsfwiw',
      network: 'mainnet',
      solBalance: 0,
      tokens: [
        {
          mint: BONK_MAINNET_MINT,
          name: 'Bonk',
          symbol: 'BONK',
          logo: 'https://example.com/bonk.png',
          balance: '42',
          decimals: 5,
          verified: true,
          spam: false,
        },
      ],
      fetchedAt: 123,
    };

    await observeOfflineTokenMetadataFromWalletBalance(balance);

    await expect(getOfflineTokenDecimals('mainnet', BONK_MAINNET_MINT)).resolves.toBe(5);
    await expect(getOfflineTokenMetadata('mainnet', BONK_MAINNET_MINT)).resolves.toMatchObject({
      logo: 'https://example.com/bonk.png',
    });
    await expect(getOfflineTokenDecimals('devnet', BONK_MAINNET_MINT)).resolves.toBeNull();
    await expect(getOfflineTokenDecimals('mainnet', 'BONK')).resolves.toBeNull();
  });

  it('stores swap-token metadata for later offline decimal verification', async () => {
    await observeOfflineTokenMetadataFromSwapTokens('mainnet', [
      {
        mint: BONK_MAINNET_MINT,
        name: 'Bonk',
        symbol: 'BONK',
        logo: 'https://example.com/bonk-swap.png',
        decimals: 5,
        verified: true,
      },
    ]);

    await expect(getOfflineTokenMetadata('mainnet', BONK_MAINNET_MINT)).resolves.toMatchObject({
      symbol: 'BONK',
      decimals: 5,
      verified: true,
      logo: 'https://example.com/bonk-swap.png',
    });
  });

  it('resolves backend-supported stablecoin symbols that are not built in for a network', async () => {
    await expect(getOfflineTokenMetadata('devnet', 'USDT')).resolves.toBeNull();

    await observeOfflineSupportedStablecoins('devnet', [
      {
        symbol: 'USDT',
        mint: BONK_MAINNET_MINT,
        decimals: 6,
        enabled: true,
        name: 'Tether USD',
        programId: 'TokenzQdBNbLqP5VEhdkAS6EPFjcq7eHkuhk9Vum6R4',
      },
    ]);

    await expect(getOfflineTokenMetadata('devnet', 'USDT')).resolves.toMatchObject({
      symbol: 'USDT',
      mint: BONK_MAINNET_MINT,
      decimals: 6,
      programId: 'TokenzQdBNbLqP5VEhdkAS6EPFjcq7eHkuhk9Vum6R4',
    });
  });
});
