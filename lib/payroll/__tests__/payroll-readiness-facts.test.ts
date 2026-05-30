import { buildPayrollRouteFacts } from '@/lib/payroll/payroll-readiness-facts';

import type { CapabilitiesResponse } from '@/types/offpay-api';

const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function availableStatus() {
  return { available: true, reason: 'available' as const };
}

function fullCapabilities(): CapabilitiesResponse['capabilities'] {
  // Only the fields the facts composer reads need to be present/available.
  return {
    wallet: { balance: availableStatus(), transactions: availableStatus() },
    payment: {
      privateInitMint: availableStatus(),
      privateBalance: availableStatus(),
      privateSend: availableStatus(),
      umbraPrivateP2p: availableStatus(),
      settle: availableStatus(),
      rpcBroadcast: availableStatus(),
    },
    umbra: { execution: availableStatus() },
  } as unknown as CapabilitiesResponse['capabilities'];
}

function baseInputs() {
  return {
    network: 'mainnet' as const,
    mint: MAINNET_USDC,
    capabilities: fullCapabilities(),
    walletCanSign: true,
    online: true,
    rpcReady: true,
    hasTokenBalanceForRun: true,
    hasFeeSol: true,
    umbraNativeProverAvailable: true,
    umbraVaultFeeReady: true,
    umbraSenderMixerRegistered: true,
  };
}

describe('buildPayrollRouteFacts', () => {
  it('marks both routes capability-available with full capabilities', () => {
    const facts = buildPayrollRouteFacts(baseInputs());
    expect(facts.umbraCapabilityAvailable).toBe(true);
    expect(facts.magicblockCapabilityAvailable).toBe(true);
    expect(facts.tokenSupported).toBe(true);
    expect(facts.umbraTokenSupported).toBe(true);
  });

  it('treats null capabilities as not loaded', () => {
    const facts = buildPayrollRouteFacts({ ...baseInputs(), capabilities: null });
    expect(facts.capabilitiesLoaded).toBe(false);
    expect(facts.umbraCapabilityAvailable).toBe(false);
    expect(facts.magicblockCapabilityAvailable).toBe(false);
  });

  it('requires payment.umbraPrivateP2p for Umbra capability', () => {
    const capabilities = fullCapabilities() as unknown as {
      payment: { umbraPrivateP2p: { available: boolean; reason: string } };
    };
    capabilities.payment.umbraPrivateP2p = { available: false, reason: 'not_implemented' };
    const facts = buildPayrollRouteFacts({
      ...baseInputs(),
      capabilities: capabilities as unknown as ReturnType<typeof fullCapabilities>,
    });
    expect(facts.umbraCapabilityAvailable).toBe(false);
  });

  it('marks a devnet Umbra mint supported for Umbra but not MagicBlock', () => {
    const facts = buildPayrollRouteFacts({
      ...baseInputs(),
      network: 'devnet',
      mint: '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7', // Umbra devnet dUSDC
    });
    expect(facts.umbraTokenSupported).toBe(true);
    expect(facts.tokenSupported).toBe(false);
    expect(facts.magicblockTokenSupported).toBe(false);
  });

  it('flags an unsupported mint for both routes', () => {
    const facts = buildPayrollRouteFacts({
      ...baseInputs(),
      mint: 'So11111111111111111111111111111111111111112',
    });
    // wSOL is not a stablecoin policy mint.
    expect(facts.tokenSupported).toBe(false);
    expect(facts.magicblockTokenSupported).toBe(false);
  });

  it('propagates platform prover availability', () => {
    const facts = buildPayrollRouteFacts({
      ...baseInputs(),
      umbraNativeProverAvailable: false,
    });
    expect(facts.umbraNativeProverAvailable).toBe(false);
  });
});
