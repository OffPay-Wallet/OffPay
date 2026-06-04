import {
  evaluateMagicBlockReadiness,
  evaluateUmbraReadiness,
  resolvePayrollRoute,
  umbraBlockedOnlyBySenderSetup,
  type PayrollRecipientFacts,
  type PayrollRouteFacts,
} from '@/lib/payroll/payroll-route-readiness';
import type { OffpayNetwork } from '@/types/offpay-api';

function readyFacts(overrides: Partial<PayrollRouteFacts> = {}): PayrollRouteFacts {
  return {
    network: 'mainnet' as OffpayNetwork,
    walletCanSign: true,
    online: true,
    rpcReady: true,
    capabilitiesLoaded: true,
    tokenSupported: true,
    hasTokenBalanceForRun: true,
    hasFeeSol: true,
    umbraNativeProverAvailable: true,
    umbraCapabilityAvailable: true,
    umbraVaultFeeReady: true,
    umbraTokenSupported: true,
    umbraSenderMixerRegistered: true,
    magicblockCapabilityAvailable: true,
    magicblockValidatorConfigured: true,
    magicblockTokenSupported: true,
    ...overrides,
  };
}

const registeredRecipient: PayrollRecipientFacts = {
  isSelf: false,
  umbraRecipientRegistered: true,
};

describe('payroll route readiness', () => {
  it('marks both routes ready when all facts pass', () => {
    expect(evaluateUmbraReadiness(readyFacts(), registeredRecipient).ready).toBe(true);
    expect(evaluateMagicBlockReadiness(readyFacts()).ready).toBe(true);
  });

  it('blocks payroll when the wallet cannot sign', () => {
    const facts = readyFacts({ walletCanSign: false });
    expect(evaluateUmbraReadiness(facts, registeredRecipient).blockedReasons).toContain(
      'wallet_cannot_sign',
    );
    expect(evaluateMagicBlockReadiness(facts).blockedReasons).toContain('wallet_cannot_sign');
  });

  it('does not mark routes invalid just because the payroll total exceeds balance', () => {
    const facts = readyFacts({ hasTokenBalanceForRun: false });
    expect(evaluateUmbraReadiness(facts, registeredRecipient).blockedReasons).not.toContain(
      'insufficient_balance',
    );
    expect(evaluateMagicBlockReadiness(facts).blockedReasons).not.toContain(
      'insufficient_balance',
    );
  });

  it('disables Umbra when the native prover is missing but keeps MagicBlock', () => {
    const facts = readyFacts({ umbraNativeProverAvailable: false });
    expect(evaluateUmbraReadiness(facts, registeredRecipient).ready).toBe(false);
    expect(evaluateUmbraReadiness(facts, registeredRecipient).blockedReasons).toContain(
      'umbra_prover_unavailable',
    );
    expect(evaluateMagicBlockReadiness(facts).ready).toBe(true);
  });

  it('blocks MagicBlock when the validator env is missing', () => {
    const facts = readyFacts({ magicblockValidatorConfigured: false });
    expect(evaluateMagicBlockReadiness(facts).blockedReasons).toContain(
      'magicblock_validator_missing',
    );
  });

  it('requires mainnet sender mixer registration for Umbra', () => {
    const facts = readyFacts({ network: 'mainnet', umbraSenderMixerRegistered: false });
    expect(evaluateUmbraReadiness(facts, registeredRecipient).blockedReasons).toContain(
      'umbra_sender_not_registered',
    );
  });

  it('does not enforce sender mixer registration on devnet', () => {
    const facts = readyFacts({ network: 'devnet', umbraSenderMixerRegistered: false });
    expect(evaluateUmbraReadiness(facts, registeredRecipient).blockedReasons).not.toContain(
      'umbra_sender_not_registered',
    );
  });

  it('blocks Umbra for a non-registered non-self recipient', () => {
    const evaluation = evaluateUmbraReadiness(readyFacts(), {
      isSelf: false,
      umbraRecipientRegistered: false,
    });
    expect(evaluation.blockedReasons).toContain('umbra_recipient_not_registered');
  });

  it('does not block Umbra on MagicBlock-only token support (devnet dUSDC)', () => {
    // Regression: devnet Umbra mints are not MagicBlock stablecoins. Umbra
    // must gate on its OWN token support, not the shared stablecoin policy.
    const facts = readyFacts({
      network: 'devnet',
      tokenSupported: false, // not a MagicBlock stablecoin mint
      magicblockTokenSupported: false,
      umbraTokenSupported: true, // but it IS an Umbra mint
    });
    expect(evaluateUmbraReadiness(facts, registeredRecipient).ready).toBe(true);
    expect(evaluateMagicBlockReadiness(facts).blockedReasons).toContain('token_unsupported');
  });

  it('blocks Umbra when its own token support is missing', () => {
    const facts = readyFacts({ umbraTokenSupported: false });
    expect(evaluateUmbraReadiness(facts, registeredRecipient).blockedReasons).toContain(
      'token_unsupported',
    );
  });

  describe('resolvePayrollRoute', () => {
    it('prefers Umbra under private_auto when ready', () => {
      const decision = resolvePayrollRoute({
        policy: 'private_auto',
        facts: readyFacts(),
        recipient: registeredRecipient,
        routesShareMint: true,
      });
      expect(decision.route).toBe('umbra');
    });

    it('falls back to MagicBlock under private_auto when Umbra is unready and mint aligns', () => {
      const decision = resolvePayrollRoute({
        policy: 'private_auto',
        facts: readyFacts({ umbraNativeProverAvailable: false }),
        recipient: registeredRecipient,
        routesShareMint: true,
      });
      expect(decision.route).toBe('magicblock');
    });

    it('blocks rather than silently changing mint on devnet fallback', () => {
      const decision = resolvePayrollRoute({
        policy: 'private_auto',
        facts: readyFacts({ network: 'devnet', umbraNativeProverAvailable: false }),
        recipient: registeredRecipient,
        routesShareMint: false,
      });
      expect(decision.route).toBeNull();
      expect(decision.mintWouldChangeOnFallback).toBe(true);
    });

    it('allows MagicBlock fallback when the selected mint is not an Umbra mint', () => {
      const decision = resolvePayrollRoute({
        policy: 'private_auto',
        facts: readyFacts({
          network: 'devnet',
          umbraTokenSupported: false,
          umbraVaultFeeReady: false,
          magicblockTokenSupported: true,
        }),
        recipient: registeredRecipient,
        routesShareMint: false,
      });
      expect(decision.route).toBe('magicblock');
      expect(decision.mintWouldChangeOnFallback).toBe(false);
    });

    it('never selects MagicBlock under umbra_only', () => {
      const decision = resolvePayrollRoute({
        policy: 'umbra_only',
        facts: readyFacts({ umbraVaultFeeReady: false }),
        recipient: registeredRecipient,
        routesShareMint: true,
      });
      expect(decision.route).toBeNull();
      expect(decision.blockedReasons).toContain('umbra_vault_unready');
    });

    it('uses MagicBlock under magicblock_only when ready', () => {
      const decision = resolvePayrollRoute({
        policy: 'magicblock_only',
        facts: readyFacts(),
        recipient: registeredRecipient,
        routesShareMint: true,
      });
      expect(decision.route).toBe('magicblock');
    });
  });

  describe('umbraBlockedOnlyBySenderSetup', () => {
    it('is true on mainnet when the sole blocker is sender registration', () => {
      const facts = readyFacts({ network: 'mainnet', umbraSenderMixerRegistered: false });
      expect(umbraBlockedOnlyBySenderSetup(facts, registeredRecipient)).toBe(true);
    });

    it('is false when another gate also blocks Umbra (e.g. no prover)', () => {
      const facts = readyFacts({
        network: 'mainnet',
        umbraSenderMixerRegistered: false,
        umbraNativeProverAvailable: false,
      });
      expect(umbraBlockedOnlyBySenderSetup(facts, registeredRecipient)).toBe(false);
    });

    it('is false when the recipient is not registered (setup alone would not help)', () => {
      const facts = readyFacts({ network: 'mainnet', umbraSenderMixerRegistered: false });
      expect(
        umbraBlockedOnlyBySenderSetup(facts, { isSelf: false, umbraRecipientRegistered: false }),
      ).toBe(false);
    });

    it('is false when Umbra is already fully ready', () => {
      expect(umbraBlockedOnlyBySenderSetup(readyFacts(), registeredRecipient)).toBe(false);
    });
  });
});
