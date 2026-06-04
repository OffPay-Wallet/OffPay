import type { PayrollRoute, PayrollRoutePolicy } from '@/lib/payroll/payroll-types';
import type { OffpayNetwork } from '@/types/offpay-api';

/**
 * Reason codes for why a route is unavailable. UI maps these to copy; tests
 * assert on the stable code rather than prose.
 */
export type PayrollRouteBlockReason =
  | 'wallet_cannot_sign'
  | 'network_offline'
  | 'rpc_unavailable'
  | 'token_unsupported'
  | 'insufficient_balance'
  | 'insufficient_fee_sol'
  | 'capabilities_loading'
  | 'umbra_prover_unavailable'
  | 'umbra_capability_unavailable'
  | 'umbra_vault_unready'
  | 'umbra_sender_not_registered'
  | 'umbra_recipient_not_registered'
  | 'magicblock_validator_missing'
  | 'magicblock_capability_unavailable';

/**
 * Facts gathered (async, elsewhere) and fed into the pure evaluator. Keeping
 * the evaluator pure means route logic is fully unit-testable without I/O.
 */
export interface PayrollRouteFacts {
  network: OffpayNetwork;
  /** Active wallet has local signing material (not address-only Privy). */
  walletCanSign: boolean;
  online: boolean;
  rpcReady: boolean;
  capabilitiesLoaded: boolean;
  /** Mint is a supported stablecoin for the active network. */
  tokenSupported: boolean;
  hasTokenBalanceForRun: boolean;
  hasFeeSol: boolean;

  // Umbra-specific
  umbraNativeProverAvailable: boolean;
  umbraCapabilityAvailable: boolean;
  umbraVaultFeeReady: boolean;
  umbraTokenSupported: boolean;
  /** Mainnet only: sender mixer registration. Ignored on devnet. */
  umbraSenderMixerRegistered: boolean;

  // MagicBlock-specific
  magicblockCapabilityAvailable: boolean;
  magicblockValidatorConfigured: boolean;
  magicblockTokenSupported: boolean;
}

/** Per-recipient facts layered on top of run-level facts. */
export interface PayrollRecipientFacts {
  isSelf: boolean;
  /** Recipient is registered for Umbra private receipt (non-self). */
  umbraRecipientRegistered: boolean;
}

export interface PayrollRouteEvaluation {
  ready: boolean;
  blockedReasons: PayrollRouteBlockReason[];
}

function evaluateSharedGates(facts: PayrollRouteFacts): PayrollRouteBlockReason[] {
  const reasons: PayrollRouteBlockReason[] = [];
  if (!facts.walletCanSign) reasons.push('wallet_cannot_sign');
  if (!facts.online) reasons.push('network_offline');
  if (!facts.capabilitiesLoaded) reasons.push('capabilities_loading');
  if (!facts.rpcReady) reasons.push('rpc_unavailable');
  if (!facts.hasFeeSol) reasons.push('insufficient_fee_sol');
  // NOTE: token support is intentionally NOT gated here. Umbra and
  // MagicBlock support different mints (notably on devnet, where Umbra uses
  // dUSDC/dUSDT and MagicBlock uses its own USDC). Each route checks its own
  // token support below so a route-specific mint is not blocked by the other
  // route's policy.
  return reasons;
}

export function evaluateUmbraReadiness(
  facts: PayrollRouteFacts,
  recipient?: PayrollRecipientFacts,
): PayrollRouteEvaluation {
  const reasons = evaluateSharedGates(facts);
  if (!facts.umbraNativeProverAvailable) reasons.push('umbra_prover_unavailable');
  if (!facts.umbraCapabilityAvailable) reasons.push('umbra_capability_unavailable');
  if (!facts.umbraTokenSupported) reasons.push('token_unsupported');
  if (!facts.umbraVaultFeeReady) reasons.push('umbra_vault_unready');

  // Sender mixer registration is enforced on mainnet only; the devnet send
  // path does not require it.
  if (facts.network === 'mainnet' && !facts.umbraSenderMixerRegistered) {
    reasons.push('umbra_sender_not_registered');
  }

  // A non-self recipient must be Umbra-registered to receive a private P2P.
  if (recipient != null && !recipient.isSelf && !recipient.umbraRecipientRegistered) {
    reasons.push('umbra_recipient_not_registered');
  }

  return { ready: reasons.length === 0, blockedReasons: dedupe(reasons) };
}

export function evaluateMagicBlockReadiness(facts: PayrollRouteFacts): PayrollRouteEvaluation {
  const reasons = evaluateSharedGates(facts);
  if (!facts.magicblockCapabilityAvailable) reasons.push('magicblock_capability_unavailable');
  if (!facts.magicblockValidatorConfigured) reasons.push('magicblock_validator_missing');
  if (!facts.magicblockTokenSupported) reasons.push('token_unsupported');
  return { ready: reasons.length === 0, blockedReasons: dedupe(reasons) };
}

/**
 * Whether Umbra would become usable for a recipient if the ONLY remaining
 * blocker — the sender's one-time mixer registration — were resolved.
 *
 * Drives the mainnet "Set up Umbra" preflight: under `private_auto`, an
 * unregistered sender otherwise causes Umbra to be silently dropped in favor
 * of MagicBlock. This returns true only when sender registration is the sole
 * gap (prover, capability, vault fee, token, recipient registration, balance,
 * etc. all pass), so we never prompt setup that can't actually unblock Umbra
 * (e.g. on iOS with no prover, or an unsupported token).
 */
export function umbraBlockedOnlyBySenderSetup(
  facts: PayrollRouteFacts,
  recipient: PayrollRecipientFacts,
): boolean {
  const evaluation = evaluateUmbraReadiness(facts, recipient);
  return (
    evaluation.blockedReasons.length === 1 &&
    evaluation.blockedReasons[0] === 'umbra_sender_not_registered'
  );
}

export interface PayrollRouteDecision {
  route: PayrollRoute | null;
  umbra: PayrollRouteEvaluation;
  magicblock: PayrollRouteEvaluation;
  /**
   * True when `private_auto` would move the row to MagicBlock with a mint
   * different from the Umbra mint. Devnet blocks this silent change.
   */
  mintWouldChangeOnFallback: boolean;
  blockedReasons: PayrollRouteBlockReason[];
}

/**
 * Resolves the route for a single recipient under a policy. Pure: callers
 * supply pre-gathered facts plus whether an auto-fallback to MagicBlock
 * would change the on-chain mint.
 */
export function resolvePayrollRoute(params: {
  policy: PayrollRoutePolicy;
  facts: PayrollRouteFacts;
  recipient: PayrollRecipientFacts;
  /** Whether Umbra and MagicBlock would use the same mint on this network. */
  routesShareMint: boolean;
}): PayrollRouteDecision {
  const umbra = evaluateUmbraReadiness(params.facts, params.recipient);
  const magicblock = evaluateMagicBlockReadiness(params.facts);
  const mintWouldChangeOnFallback = !params.routesShareMint && params.facts.umbraTokenSupported;

  if (params.policy === 'umbra_only') {
    return {
      route: umbra.ready ? 'umbra' : null,
      umbra,
      magicblock,
      mintWouldChangeOnFallback,
      blockedReasons: umbra.ready ? [] : umbra.blockedReasons,
    };
  }

  if (params.policy === 'magicblock_only') {
    return {
      route: magicblock.ready ? 'magicblock' : null,
      umbra,
      magicblock,
      mintWouldChangeOnFallback,
      blockedReasons: magicblock.ready ? [] : magicblock.blockedReasons,
    };
  }

  // private_auto: Umbra first.
  if (umbra.ready) {
    return { route: 'umbra', umbra, magicblock, mintWouldChangeOnFallback, blockedReasons: [] };
  }

  // Fall back to MagicBlock only when it is ready AND the mint does not
  // silently change. A mint change requires explicit user restaging.
  if (magicblock.ready && !mintWouldChangeOnFallback) {
    return {
      route: 'magicblock',
      umbra,
      magicblock,
      mintWouldChangeOnFallback,
      blockedReasons: [],
    };
  }

  return {
    route: null,
    umbra,
    magicblock,
    mintWouldChangeOnFallback,
    blockedReasons: dedupe([
      ...umbra.blockedReasons,
      ...(mintWouldChangeOnFallback ? [] : magicblock.blockedReasons),
    ]),
  };
}

function dedupe(reasons: PayrollRouteBlockReason[]): PayrollRouteBlockReason[] {
  return Array.from(new Set(reasons));
}
