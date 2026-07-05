import { describe, expect, it } from '@jest/globals';

import { getCapabilities } from '../capabilities';
import type { Bindings } from '../types';

const PROGRAM_ID = '4gFd61LGkcfMzK6i7dB96EfxHPgWRZRw8Q3q1rWCiqu7';
const MAGICBLOCK_VALIDATORS =
  'MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57,MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e';

function buildBindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    JUPITER_API_KEY: 'jupiter-key',
    OFFPAY_BOOTSTRAP_SECRET: 'bootstrap',
    BOOTSTRAP_SECRET_VERSION: '1',
    OFFPAY_BACKUP_HMAC_SECRET: 'backup',
    MAGICBLOCK_DEVNET_VALIDATORS: MAGICBLOCK_VALIDATORS,
    MAGICBLOCK_MAINNET_VALIDATORS: MAGICBLOCK_VALIDATORS,
    ...overrides,
  } as Bindings;
}

describe('capabilities RWA MagicBlock delegation gates', () => {
  it('advertises devnet RWA intent delegation only when the program and router are configured', async () => {
    const response = await getCapabilities(
      buildBindings({
        OFFPAY_RWA_DELEGATE_PROGRAM_ID: PROGRAM_ID,
        OFFPAY_RWA_DELEGATE_DEVNET_ENABLED: '1',
        OFFPAY_RWA_MAGICBLOCK_ROUTER_DEVNET_URL: 'https://devnet-router.magicblock.app',
      }),
      'devnet',
    );

    expect(response.capabilities.rwa.magicBlockIntent).toMatchObject({
      available: true,
      reason: 'available',
    });
    expect(response.capabilities.rwa.magicBlockTransfer).toMatchObject({
      available: false,
      reason: 'not_implemented',
    });
    expect(response.capabilities.rwa.magicBlockTransfer.message).toContain('Direct MagicBlock');
  });

  it('keeps devnet RWA intent delegation disabled without a deployed program id', async () => {
    const response = await getCapabilities(
      buildBindings({
        OFFPAY_RWA_DELEGATE_DEVNET_ENABLED: '1',
        OFFPAY_RWA_MAGICBLOCK_ROUTER_DEVNET_URL: 'https://devnet-router.magicblock.app',
      }),
      'devnet',
    );

    expect(response.capabilities.rwa.magicBlockIntent).toMatchObject({
      available: false,
      reason: 'not_implemented',
    });
  });

  it('keeps mainnet RWA intent delegation gated separately from devnet', async () => {
    const response = await getCapabilities(
      buildBindings({
        OFFPAY_RWA_DELEGATE_PROGRAM_ID: PROGRAM_ID,
        OFFPAY_RWA_DELEGATE_DEVNET_ENABLED: '1',
        OFFPAY_RWA_DELEGATE_MAINNET_ENABLED: '0',
        OFFPAY_RWA_MAGICBLOCK_ROUTER_DEVNET_URL: 'https://devnet-router.magicblock.app',
        OFFPAY_RWA_MAGICBLOCK_ROUTER_MAINNET_URL: 'https://mainnet-router.magicblock.app',
      }),
      'mainnet',
    );

    expect(response.capabilities.rwa.magicBlockIntent).toMatchObject({
      available: false,
      reason: 'not_implemented',
    });
    expect(response.capabilities.rwa.magicBlockIntent.message).toContain('after audit');
  });
});
