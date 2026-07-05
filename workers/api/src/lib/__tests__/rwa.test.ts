import { describe, expect, it } from '@jest/globals';

import { getRwaAssets, getRwaPrice } from '../rwa';

import type { Bindings } from '../types';

const bindings = {
  OFFPAY_DEVNET_USDC_MINT: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
} as Bindings;

describe('RWA devnet catalog', () => {
  it('returns devnet sandbox assets settled in configured USDC', () => {
    const response = getRwaAssets(bindings, 'devnet');

    expect(response.mode).toBe('devnet_sandbox');
    expect(response.assets).toHaveLength(3);
    expect(response.assets[0]).toMatchObject({
      symbol: 'dAAPLx',
      network: 'devnet',
      provider: 'offpay-devnet',
      settlementMint: bindings.OFFPAY_DEVNET_USDC_MINT,
      tradable: false,
      devnetSandbox: true,
      magicBlockEligible: false,
    });
  });

  it('lets the RWA settlement mint override the default devnet USDC mint', () => {
    const response = getRwaAssets(
      {
        ...bindings,
        OFFPAY_RWA_DEVNET_SETTLEMENT_MINT: 'So11111111111111111111111111111111111111112',
      },
      'devnet',
    );

    expect(response.assets.every((asset) => asset.settlementMint === 'So11111111111111111111111111111111111111112')).toBe(
      true,
    );
  });

  it('keeps mainnet disabled during the devnet-first phase', () => {
    const response = getRwaAssets(bindings, 'mainnet');

    expect(response.mode).toBe('mainnet_disabled');
    expect(response.assets).toEqual([]);
  });

  it('returns a price for a devnet RWA asset by mint', () => {
    const asset = getRwaAssets(bindings, 'devnet').assets[1]!;
    const response = getRwaPrice(bindings, {
      mint: asset.mint,
      network: 'devnet',
    });

    expect(response).toMatchObject({
      mint: asset.mint,
      symbol: asset.symbol,
      price: asset.priceUsd,
      currency: 'USD',
      provider: 'offpay-devnet',
    });
  });

  it('rejects price lookup for unavailable assets', () => {
    expect(() =>
      getRwaPrice(bindings, {
        mint: 'So11111111111111111111111111111111111111112',
        network: 'devnet',
      }),
    ).toThrow('RWA asset is not available on this network.');
  });
});
