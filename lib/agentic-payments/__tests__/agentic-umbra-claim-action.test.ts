import {
  buildAgenticUmbraClaimCandidate,
  executeAgenticUmbraClaimAction,
} from '@/lib/agentic-payments/umbra-claim-action';
import type { UmbraExecutionResult } from '@/lib/umbra/umbra-types';
import type { AgenticUmbraClaimAction } from '@/store/agenticChatStore';

const walletAddress = '11111111111111111111111111111111';

function action(indices: number[]): AgenticUmbraClaimAction {
  return {
    id: 'claim-1',
    kind: 'umbra_claim',
    status: 'needs_confirmation',
    walletAddress,
    network: 'mainnet',
    utxoInsertionIndices: indices,
    claimCount: indices.length,
    destination: 'umbra_encrypted_balance',
    createdAt: 1,
    updatedAt: 1,
  };
}

function scanResult(indices: number[]): UmbraExecutionResult {
  return {
    action: 'claim',
    walletAddress,
    network: 'mainnet',
    title: 'Private payment ready',
    subtitle: 'Ready',
    signatures: [],
    pendingClaimCount: indices.length,
    pendingClaimUtxoInsertionIndices: indices,
    vaultCanShield: true,
    mixerRegistered: true,
  };
}

function api(params: {
  scan: jest.Mock;
  claim?: jest.Mock;
}): Parameters<typeof executeAgenticUmbraClaimAction>[0]['api'] {
  return {
    scanUmbraPrivateP2PClaims: params.scan,
    claimUmbraPrivateP2PToEncryptedBalance: params.claim ?? jest.fn(),
    getUmbraClaimScanRangeForInsertionIndices: (indices) => ({
      scanMode: 'range',
      startInsertionIndex: Math.min(...(indices ?? [])),
      endInsertionIndex: Math.max(...(indices ?? [])),
    }),
  } as Parameters<typeof executeAgenticUmbraClaimAction>[0]['api'];
}

describe('agentic Umbra claim actions', () => {
  it('requires a complete unique scan set and completed Umbra setup', () => {
    expect(buildAgenticUmbraClaimCandidate(scanResult([10, 11]))).toEqual({
      ok: true,
      claimCount: 2,
      utxoInsertionIndices: [10, 11],
    });
    expect(
      buildAgenticUmbraClaimCandidate({
        ...scanResult([10, 10]),
        pendingClaimCount: 2,
      }),
    ).toEqual({ ok: false, code: 'umbra_claim_scan_incomplete' });
    expect(
      buildAgenticUmbraClaimCandidate({ ...scanResult([10]), mixerRegistered: false }),
    ).toEqual({ ok: false, code: 'umbra_claim_setup_required' });
  });

  it('freshly rescans without cache and refuses a changed claim set', async () => {
    const scan = jest.fn(async () => scanResult([10, 12]));
    const claim = jest.fn();

    const outcome = await executeAgenticUmbraClaimAction({
      action: action([10, 11]),
      walletId: 'wallet-1',
      api: api({ scan, claim }),
      onInsertionIndicesSettled: jest.fn(),
    });

    expect(outcome).toMatchObject({ status: 'stale', currentPendingCount: 2 });
    expect(scan).toHaveBeenCalledWith(
      expect.objectContaining({ bypassCache: true, pageLimit: 48 }),
    );
    expect(claim).not.toHaveBeenCalled();
  });

  it('records a partial result without treating unresolved claims as success', async () => {
    const scan = jest.fn(async () => scanResult([10, 11]));
    const claim = jest.fn(async (params) => {
      params.onUtxoClaimedOnChain([10]);
      return {
        ...scanResult([11]),
        title: 'Claim partly succeeded',
        claimedUtxoCount: 1,
        claimedUtxoInsertionIndices: [10],
        pendingClaimCount: 1,
        pendingClaimUtxoInsertionIndices: [11],
        signatures: ['signature-1'],
      } satisfies UmbraExecutionResult;
    });
    const settled = jest.fn();

    const outcome = await executeAgenticUmbraClaimAction({
      action: action([10, 11]),
      walletId: 'wallet-1',
      api: api({ scan, claim }),
      onInsertionIndicesSettled: settled,
    });

    expect(outcome).toMatchObject({
      status: 'executed',
      settledInsertionIndices: [10],
      remainingInsertionIndices: [11],
    });
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ bypassCache: true, pageLimit: 48 }),
    );
    expect(settled).toHaveBeenCalledWith([10]);
  });

  it('marks the confirmed set settled when the fresh on-chain scan is empty', async () => {
    const settled = jest.fn();
    const claim = jest.fn();
    const outcome = await executeAgenticUmbraClaimAction({
      action: action([10, 11]),
      walletId: 'wallet-1',
      api: api({ scan: jest.fn(async () => scanResult([])), claim }),
      onInsertionIndicesSettled: settled,
    });

    expect(outcome).toEqual({ status: 'already_settled', settledInsertionIndices: [10, 11] });
    expect(settled).toHaveBeenCalledWith([10, 11]);
    expect(claim).not.toHaveBeenCalled();
  });

  it('rejects claim results outside the user-confirmed insertion set', async () => {
    await expect(
      executeAgenticUmbraClaimAction({
        action: action([10]),
        walletId: 'wallet-1',
        api: api({
          scan: jest.fn(async () => scanResult([10])),
          claim: jest.fn(async () => ({
            ...scanResult([]),
            claimedUtxoCount: 1,
            claimedUtxoInsertionIndices: [999],
          })),
        }),
        onInsertionIndicesSettled: jest.fn(),
      }),
    ).rejects.toThrow('outside the confirmed claim set');
  });
});
