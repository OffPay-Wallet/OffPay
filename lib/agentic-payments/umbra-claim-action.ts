import type { AgenticUmbraClaimAction } from '@/store/agenticChatStore';
import type { UmbraExecutionResult } from '@/lib/umbra/umbra-types';

type UmbraExecutionApi = Pick<
  typeof import('@/lib/umbra/umbra-execution'),
  | 'scanUmbraPrivateP2PClaims'
  | 'claimUmbraPrivateP2PToEncryptedBalance'
  | 'getUmbraClaimScanRangeForInsertionIndices'
>;

const AGENTIC_UMBRA_CLAIM_PAGE_SIZE = 48;
const MAX_AGENTIC_UMBRA_CLAIM_COUNT = 200;
const MAX_AGENTIC_UMBRA_CLAIM_SPAN = 500;

type UmbraClaimScanSummary = Pick<
  UmbraExecutionResult,
  'pendingClaimCount' | 'pendingClaimUtxoInsertionIndices' | 'vaultCanShield' | 'mixerRegistered'
>;

export type AgenticUmbraClaimCandidate =
  | {
      ok: true;
      claimCount: number;
      utxoInsertionIndices: number[];
    }
  | {
      ok: false;
      code:
        | 'no_pending_umbra_claims'
        | 'umbra_claim_scan_incomplete'
        | 'umbra_claim_setup_required'
        | 'umbra_claim_batch_too_large';
    };

export type AgenticUmbraClaimExecutionOutcome =
  | { status: 'already_settled'; settledInsertionIndices: number[] }
  | {
      status: 'stale';
      currentPendingCount: number;
      currentInsertionIndices: number[];
    }
  | {
      status: 'executed';
      result: UmbraExecutionResult;
      settledInsertionIndices: number[];
      remainingInsertionIndices: number[];
    };

function normalizeInsertionIndices(values: readonly number[] | null | undefined): number[] | null {
  const input = values ?? [];
  if (!input.every((value) => Number.isSafeInteger(value) && value >= 0)) return null;
  const unique = [...new Set(input)].sort((left, right) => left - right);
  return unique.length === input.length ? unique : null;
}

function inspectScan(summary: UmbraClaimScanSummary): AgenticUmbraClaimCandidate {
  const count = summary.pendingClaimCount;
  if (!Number.isSafeInteger(count) || count == null || count < 0) {
    return { ok: false, code: 'umbra_claim_scan_incomplete' };
  }

  const indices = normalizeInsertionIndices(summary.pendingClaimUtxoInsertionIndices);
  if (indices == null || indices.length !== count) {
    return { ok: false, code: 'umbra_claim_scan_incomplete' };
  }
  if (count === 0) return { ok: false, code: 'no_pending_umbra_claims' };
  if (count > MAX_AGENTIC_UMBRA_CLAIM_COUNT) {
    return { ok: false, code: 'umbra_claim_batch_too_large' };
  }

  const first = indices[0];
  const last = indices.at(-1);
  if (first == null || last == null || last - first > MAX_AGENTIC_UMBRA_CLAIM_SPAN) {
    return { ok: false, code: 'umbra_claim_batch_too_large' };
  }
  if (summary.vaultCanShield !== true || summary.mixerRegistered !== true) {
    return { ok: false, code: 'umbra_claim_setup_required' };
  }

  return { ok: true, claimCount: count, utxoInsertionIndices: indices };
}

export function buildAgenticUmbraClaimCandidate(
  summary: UmbraClaimScanSummary,
): AgenticUmbraClaimCandidate {
  return inspectScan(summary);
}

function sameInsertionIndices(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertResultIndices(params: {
  result: UmbraExecutionResult;
  expected: readonly number[];
}): { claimed: number[]; remaining: number[] } {
  const claimed = normalizeInsertionIndices(params.result.claimedUtxoInsertionIndices);
  const remaining = normalizeInsertionIndices(params.result.pendingClaimUtxoInsertionIndices);
  if (claimed == null || remaining == null) {
    throw new Error('Umbra claim returned malformed insertion indices.');
  }

  const expected = new Set(params.expected);
  if (
    claimed.some((value) => !expected.has(value)) ||
    remaining.some((value) => !expected.has(value)) ||
    claimed.some((value) => remaining.includes(value))
  ) {
    throw new Error('Umbra claim returned indices outside the confirmed claim set.');
  }

  const claimedCount = params.result.claimedUtxoCount ?? claimed.length;
  const pendingCount = params.result.pendingClaimCount ?? remaining.length;
  if (
    !Number.isSafeInteger(claimedCount) ||
    claimedCount < 0 ||
    claimedCount !== claimed.length ||
    !Number.isSafeInteger(pendingCount) ||
    pendingCount < 0 ||
    pendingCount !== remaining.length
  ) {
    throw new Error('Umbra claim returned inconsistent claim counts.');
  }

  return { claimed, remaining };
}

export async function executeAgenticUmbraClaimAction(params: {
  action: AgenticUmbraClaimAction;
  walletId: string;
  api: UmbraExecutionApi;
  signal?: AbortSignal;
  onInsertionIndicesSettled: (insertionIndices: readonly number[]) => void;
}): Promise<AgenticUmbraClaimExecutionOutcome> {
  const expected = normalizeInsertionIndices(params.action.utxoInsertionIndices);
  if (
    expected == null ||
    expected.length === 0 ||
    expected.length !== params.action.claimCount ||
    params.action.destination !== 'umbra_encrypted_balance'
  ) {
    throw new Error('Umbra claim confirmation is malformed. Prepare a fresh claim.');
  }

  const scanRange = params.api.getUmbraClaimScanRangeForInsertionIndices(expected);
  const freshScan = await params.api.scanUmbraPrivateP2PClaims({
    walletAddress: params.action.walletAddress,
    walletId: params.walletId,
    network: params.action.network,
    ...scanRange,
    pageLimit: AGENTIC_UMBRA_CLAIM_PAGE_SIZE,
    bypassCache: true,
    signal: params.signal,
  });
  const freshCandidate = inspectScan(freshScan);
  if (!freshCandidate.ok) {
    if (freshCandidate.code === 'no_pending_umbra_claims') {
      params.onInsertionIndicesSettled(expected);
      return { status: 'already_settled', settledInsertionIndices: expected };
    }
    if (freshCandidate.code === 'umbra_claim_setup_required') {
      throw new Error('Umbra setup changed. Complete Umbra setup and prepare a fresh claim.');
    }
    throw new Error('Umbra claim scan could not be verified. Prepare a fresh claim.');
  }

  if (!sameInsertionIndices(expected, freshCandidate.utxoInsertionIndices)) {
    return {
      status: 'stale',
      currentPendingCount: freshCandidate.claimCount,
      currentInsertionIndices: freshCandidate.utxoInsertionIndices,
    };
  }

  let callbackViolation = false;
  const result = await params.api.claimUmbraPrivateP2PToEncryptedBalance({
    walletAddress: params.action.walletAddress,
    walletId: params.walletId,
    network: params.action.network,
    ...scanRange,
    pageLimit: AGENTIC_UMBRA_CLAIM_PAGE_SIZE,
    bypassCache: true,
    signal: params.signal,
    onUtxoClaimedOnChain: (insertionIndices) => {
      const settled = normalizeInsertionIndices(insertionIndices);
      const expectedSet = new Set(expected);
      if (settled == null || settled.some((value) => !expectedSet.has(value))) {
        callbackViolation = true;
        return;
      }
      params.onInsertionIndicesSettled(settled);
    },
  });

  if (
    callbackViolation ||
    result.action !== 'claim' ||
    result.walletAddress !== params.action.walletAddress ||
    result.network !== params.action.network
  ) {
    throw new Error('Umbra claim result did not match the confirmed wallet and network.');
  }

  const { remaining } = assertResultIndices({ result, expected });
  const remainingSet = new Set(remaining);
  const settledInsertionIndices = expected.filter((value) => !remainingSet.has(value));
  if (settledInsertionIndices.length === 0 && remaining.length > 0) {
    throw new Error('Umbra claim made no verifiable progress. Prepare a fresh claim and retry.');
  }
  params.onInsertionIndicesSettled(settledInsertionIndices);

  return {
    status: 'executed',
    result,
    settledInsertionIndices,
    remainingInsertionIndices: remaining,
  };
}

export const __agenticUmbraClaimInternal = {
  AGENTIC_UMBRA_CLAIM_PAGE_SIZE,
  MAX_AGENTIC_UMBRA_CLAIM_COUNT,
  MAX_AGENTIC_UMBRA_CLAIM_SPAN,
  normalizeInsertionIndices,
};
