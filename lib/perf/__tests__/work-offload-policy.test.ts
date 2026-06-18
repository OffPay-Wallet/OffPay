import {
  assertWorkerCandidateSafe,
  classifyWorkerCandidate,
  getSecureLocalOnlyRule,
  type WorkOffloadDecision,
} from '@/lib/perf/work-offload-policy';

describe('work-offload-policy', () => {
  it('allows public and wallet-scoped worker candidates', () => {
    expect(() =>
      assertWorkerCandidateSafe(
        classifyWorkerCandidate({
          name: 'offline.noncePool.status',
          security: 'walletScoped',
          reason: 'public account-state read',
        }),
      ),
    ).not.toThrow();
  });

  it('rejects local-secret work marked for worker offload', () => {
    const unsafeDecision: WorkOffloadDecision = {
      name: 'wallet.signingSeed',
      target: 'worker:publicOnly',
      security: 'localSecret',
    };

    expect(() => assertWorkerCandidateSafe(unsafeDecision)).toThrow(getSecureLocalOnlyRule());
  });
});
