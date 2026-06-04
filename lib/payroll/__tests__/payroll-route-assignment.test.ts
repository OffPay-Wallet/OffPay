import {
  applyRouteAssignment,
  assignPayrollRoutes,
  routesShareMint,
} from '@/lib/payroll/payroll-route-assignment';

import type {
  PayrollRecipientFacts,
  PayrollRouteFacts,
} from '@/lib/payroll/payroll-route-readiness';
import type { PayrollRow } from '@/lib/payroll/payroll-types';
import type { OffpayNetwork } from '@/types/offpay-api';

const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MAINNET_USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const DEVNET_UMBRA_USDC = '4oG4sjmopf5MzvTHLE8rpVJ2uyczxfsw2K84SUTpNDx7';
const DEVNET_MAGICBLOCK_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

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

function makeRow(id: string, recipient: string): PayrollRow {
  const now = Date.now();
  return {
    id,
    sourceRow: 2,
    label: null,
    recipient,
    tokenMint: MAINNET_USDC,
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    amountAtomic: '1000000',
    amountDisplay: '1',
    route: null,
    status: 'ready',
    requiresRecipientClaim: false,
    validationError: null,
    signature: null,
    txId: null,
    initSignature: null,
    idempotencyKey: `${id}-key`,
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

const REGISTERED: PayrollRecipientFacts = { isSelf: false, umbraRecipientRegistered: true };
const UNREGISTERED: PayrollRecipientFacts = { isSelf: false, umbraRecipientRegistered: false };

describe('routesShareMint', () => {
  it('is true for mainnet USDC (shared by both routes)', () => {
    expect(routesShareMint('mainnet', MAINNET_USDC)).toBe(true);
  });

  it('is true for mainnet USDT (shared by both routes)', () => {
    expect(routesShareMint('mainnet', MAINNET_USDT)).toBe(true);
  });

  it('is false on devnet where Umbra and MagicBlock use different USDC mints', () => {
    expect(routesShareMint('devnet', DEVNET_UMBRA_USDC)).toBe(false);
    expect(routesShareMint('devnet', DEVNET_MAGICBLOCK_USDC)).toBe(false);
  });
});

describe('assignPayrollRoutes', () => {
  it('routes registered recipients via Umbra and counts claim-required', () => {
    const rows = [makeRow('a', 'rcpt-a'), makeRow('b', 'rcpt-b')];
    const assignment = assignPayrollRoutes({
      rows,
      policy: 'private_auto',
      facts: readyFacts(),
      mint: MAINNET_USDC,
      recipientFactsByAddress: { 'rcpt-a': REGISTERED, 'rcpt-b': REGISTERED },
    });

    expect(assignment.split.umbra).toBe(2);
    expect(assignment.split.claimRequired).toBe(2);
    expect(assignment.split.blocked).toBe(0);
  });

  it('falls back unregistered recipients to MagicBlock on mainnet (shared mint)', () => {
    const rows = [makeRow('a', 'rcpt-a')];
    const assignment = assignPayrollRoutes({
      rows,
      policy: 'private_auto',
      facts: readyFacts(),
      mint: MAINNET_USDC,
      recipientFactsByAddress: { 'rcpt-a': UNREGISTERED },
    });

    expect(assignment.split.magicblock).toBe(1);
    expect(assignment.split.umbra).toBe(0);
  });

  it('blocks unregistered recipients on devnet rather than changing mint', () => {
    const rows = [makeRow('a', 'rcpt-a')];
    rows[0].tokenMint = DEVNET_UMBRA_USDC;
    const assignment = assignPayrollRoutes({
      rows,
      policy: 'private_auto',
      facts: readyFacts({ network: 'devnet', umbraSenderMixerRegistered: true }),
      mint: DEVNET_UMBRA_USDC,
      recipientFactsByAddress: { 'rcpt-a': UNREGISTERED },
    });

    expect(assignment.mintWouldChangeOnFallback).toBe(true);
    expect(assignment.split.blocked).toBe(1);
  });

  it('routes devnet MagicBlock USDC without probing an unsupported Umbra mint', () => {
    const rows = [makeRow('a', 'rcpt-a')];
    rows[0].tokenMint = DEVNET_MAGICBLOCK_USDC;
    const assignment = assignPayrollRoutes({
      rows,
      policy: 'private_auto',
      facts: readyFacts({
        network: 'devnet',
        umbraTokenSupported: false,
        umbraVaultFeeReady: false,
        magicblockTokenSupported: true,
      }),
      mint: DEVNET_MAGICBLOCK_USDC,
      recipientFactsByAddress: { 'rcpt-a': UNREGISTERED },
    });

    expect(assignment.mintWouldChangeOnFallback).toBe(false);
    expect(assignment.split.magicblock).toBe(1);
    expect(assignment.split.blocked).toBe(0);
  });
});

describe('applyRouteAssignment', () => {
  it('marks unroutable rows invalid and sets requiresRecipientClaim for Umbra', () => {
    const rows = [makeRow('a', 'rcpt-a'), makeRow('b', 'rcpt-b')];
    const facts = { 'rcpt-a': REGISTERED, 'rcpt-b': UNREGISTERED };
    const assignment = assignPayrollRoutes({
      rows,
      policy: 'umbra_only',
      facts: readyFacts(),
      mint: MAINNET_USDC,
      recipientFactsByAddress: facts,
    });

    const applied = applyRouteAssignment(rows, assignment, facts);
    expect(applied[0]).toMatchObject({ route: 'umbra', requiresRecipientClaim: true });
    expect(applied[1]).toMatchObject({ status: 'invalid', route: null });
    expect(applied[1].validationError).toBe('Recipient is not Umbra-ready.');
  });
});
