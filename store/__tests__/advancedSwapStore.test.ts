import {
  __advancedSwapStoreInternal,
  clearPersistedRecurringOperationIdentity,
  getOrCreatePersistedRecurringOperationIdentity,
  useAdvancedSwapStore,
} from '@/store/advancedSwapStore';

describe('advancedSwapStore recurring idempotency', () => {
  beforeEach(() => {
    useAdvancedSwapStore.setState({ receipts: [], recurringOperationIdentities: {} });
  });

  it('reuses the same key for an identical operation across caller instances', () => {
    const first = getOrCreatePersistedRecurringOperationIdentity({
      fingerprint: 'wallet:mainnet:SOL:USDC:100:daily:2',
      createKey: () => 'operation-key-1',
      now: 1_000,
    });
    const replay = getOrCreatePersistedRecurringOperationIdentity({
      fingerprint: first.fingerprint,
      createKey: () => 'operation-key-2',
      now: 2_000,
    });

    expect(replay.idempotencyKey).toBe('operation-key-1');
    expect(useAdvancedSwapStore.getState().recurringOperationIdentities).toEqual({
      [first.fingerprint]: first,
    });
  });

  it('rotates an expired identity and clears only the completed operation', () => {
    const first = getOrCreatePersistedRecurringOperationIdentity({
      fingerprint: 'first',
      createKey: () => 'first-key',
      now: 1_000,
    });
    const second = getOrCreatePersistedRecurringOperationIdentity({
      fingerprint: 'second',
      createKey: () => 'second-key',
      now: 1_000,
    });
    const rotated = getOrCreatePersistedRecurringOperationIdentity({
      fingerprint: first.fingerprint,
      createKey: () => 'rotated-key',
      now: first.expiresAt + 1,
    });

    expect(rotated.idempotencyKey).toBe('rotated-key');
    expect(useAdvancedSwapStore.getState().recurringOperationIdentities).not.toHaveProperty(
      second.fingerprint,
    );
    const live = getOrCreatePersistedRecurringOperationIdentity({
      fingerprint: 'live',
      createKey: () => 'live-key',
      now: first.expiresAt + 1,
    });

    clearPersistedRecurringOperationIdentity({ idempotencyKey: rotated.idempotencyKey });
    expect(useAdvancedSwapStore.getState().recurringOperationIdentities).toEqual({
      [live.fingerprint]: live,
    });
  });

  it('bounds the persisted operation set', () => {
    for (
      let index = 0;
      index < __advancedSwapStoreInternal.MAX_RECURRING_OPERATION_IDENTITIES + 5;
      index += 1
    ) {
      getOrCreatePersistedRecurringOperationIdentity({
        fingerprint: `fingerprint-${index}`,
        createKey: () => `operation-key-${index}`,
        now: 1_000 + index,
      });
    }

    expect(Object.keys(useAdvancedSwapStore.getState().recurringOperationIdentities)).toHaveLength(
      __advancedSwapStoreInternal.MAX_RECURRING_OPERATION_IDENTITIES,
    );
  });
});
