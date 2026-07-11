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
  it('advertises stateful Jupiter orders only with shared binding and execution-lock storage', async () => {
    const withoutSharedState = await getCapabilities(buildBindings(), 'mainnet');
    expect(withoutSharedState.capabilities.swap.triggerOrders.available).toBe(false);
    expect(withoutSharedState.capabilities.swap.recurringSwap.available).toBe(false);

    const withSharedState = await getCapabilities(
      buildBindings({
        UPSTASH_REDIS_REST_URL: 'https://redis.offpay.test',
        UPSTASH_REDIS_REST_TOKEN: 'redis-token',
      }),
      'mainnet',
    );
    expect(withSharedState.capabilities.swap.triggerOrders).toMatchObject({
      available: false,
      reason: 'not_implemented',
    });
    expect(withSharedState.capabilities.swap.triggerOrders.message).toContain(
      'cancel-and-withdraw',
    );
    expect(withSharedState.capabilities.swap.recurringSwap).toMatchObject({
      available: true,
      reason: 'available',
    });
  });

  it('fails Flash withdrawal closed without an authorized distinct co-signer', async () => {
    const response = await getCapabilities(buildBindings(), 'mainnet');

    expect(response.capabilities.perps.funding).toMatchObject({
      available: false,
      reason: 'not_implemented',
    });
    expect(response.capabilities.perps.funding.message).toContain('deposits are disabled');
    expect(response.capabilities.perps.funding.message).toContain('trapped user funds');
    expect(response.capabilities.perps.withdrawal).toMatchObject({
      available: false,
      reason: 'not_implemented',
    });
    expect(response.capabilities.perps.withdrawal.message).toContain('distinct co-signer');
    expect(response.capabilities.perps.withdrawal.message).toContain('no authorized');
  });

  it('advertises private balance only when the provider auth token store is configured', async () => {
    const withoutState = await getCapabilities(buildBindings(), 'mainnet');
    expect(withoutState.capabilities.payment.privateBalance.available).toBe(false);

    const withState = await getCapabilities(
      buildBindings({
        UPSTASH_REDIS_REST_URL: 'https://redis.offpay.test',
        UPSTASH_REDIS_REST_TOKEN: 'redis-token',
      }),
      'mainnet',
    );
    expect(withState.capabilities.payment.privateBalance).toMatchObject({
      available: true,
      reason: 'available',
    });
  });

  it('treats wildcard Jupiter stocks catalog config as available on mainnet', async () => {
    const response = await getCapabilities(
      buildBindings({
        OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST: '*',
      }),
      'mainnet',
    );

    expect(response.capabilities.rwa.assets).toMatchObject({
      available: true,
      reason: 'available',
    });
    expect(response.capabilities.rwa.quote).toMatchObject({
      available: false,
      reason: 'not_implemented',
    });
  });

  it('advertises mainnet RWA trading only after the eligibility policy is configured', async () => {
    const withoutEligibility = await getCapabilities(
      buildBindings({
        OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST: '*',
        OFFPAY_RWA_MAINNET_ENABLED: '1',
      }),
      'mainnet',
    );
    expect(withoutEligibility.capabilities.rwa.quote.available).toBe(false);

    const withEligibility = await getCapabilities(
      buildBindings({
        OFFPAY_RWA_JUPITER_STOCKS_ALLOWLIST: '*',
        OFFPAY_RWA_MAINNET_ENABLED: '1',
        OFFPAY_RWA_MAINNET_ELIGIBLE_WALLETS: '11111111111111111111111111111111',
        OFFPAY_RWA_MAINNET_ELIGIBILITY_POLICY_VERSION: 'approved-v1',
      }),
      'mainnet',
    );
    expect(withEligibility.capabilities.rwa.quote.available).toBe(true);
  });

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

  it('treats the multi-asset devnet RWA catalog as sandbox configuration', async () => {
    const response = await getCapabilities(
      buildBindings({
        OFFPAY_RWA_DELEGATE_PROGRAM_ID: PROGRAM_ID,
        OFFPAY_RWA_DELEGATE_DEVNET_ENABLED: '1',
        HELIUS_DEVNET_RPC_URL: 'https://rpc.offpay.test',
        OFFPAY_RWA_DEVNET_ASSETS_JSON:
          '[{"mint":"CrieBJEXarFm2C7vgPJs9v7M9PLuHV6axkNWhjUTwKZq","symbol":"AAPLd","name":"Apple Sandbox RWA","decimals":6,"priceReferenceMint":"Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"}]',
      }),
      'devnet',
    );

    expect(response.capabilities.rwa.assets).toMatchObject({
      available: true,
      reason: 'available',
    });
    expect(response.capabilities.rwa.quote).toMatchObject({
      available: true,
      reason: 'available',
    });
  });

  it('keeps the classic-SPL RWA delegate permanently disabled on mainnet', async () => {
    const response = await getCapabilities(
      buildBindings({
        OFFPAY_RWA_DELEGATE_PROGRAM_ID: PROGRAM_ID,
        OFFPAY_RWA_DELEGATE_DEVNET_ENABLED: '1',
        OFFPAY_RWA_MAGICBLOCK_ROUTER_DEVNET_URL: 'https://devnet-router.magicblock.app',
      }),
      'mainnet',
    );

    expect(response.capabilities.rwa.magicBlockIntent).toMatchObject({
      available: false,
      reason: 'not_implemented',
    });
    expect(response.capabilities.rwa.magicBlockIntent.message).toContain('permanently disabled');
  });
});
